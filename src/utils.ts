import * as github from '@actions/github';
import * as fs from 'fs';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import Ajv from 'ajv';
import * as path from 'path';

import { promisify } from 'util';
import { GitHubMetadata } from './contracts/collection';
import devContainerFeatureSchema from './schemas/devContainerFeature.schema.json';

export const readLocalFile = promisify(fs.readFile);
export const writeLocalFile = promisify(fs.writeFile);
export const mkdirLocal = promisify(fs.mkdir);
export const renameLocal = promisify(fs.rename);
export const readdirLocal = promisify(fs.readdir);

export function getGitHubMetadata() {
    // Insert github repo metadata
    const ref = github.context.ref;

    let metadata: GitHubMetadata = {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        ref,
        sha: github.context.sha
    };

    // Add tag if parseable
    if (ref.includes('refs/tags/')) {
        const tag = ref.replace('refs/tags/', '');
        metadata = { ...metadata, tag };
    }
    return metadata;
}

export async function isDevcontainerCliAvailable(cliDebugMode = false): Promise<boolean> {
    try {
        let cmd = 'devcontainer';
        let args = ['--version'];
        if (cliDebugMode) {
            cmd = 'npx';
            args = ['-y', './devcontainer.tgz', ...args];
        }
        const res = await exec.getExecOutput(cmd, args, {
            ignoreReturnCode: true,
            silent: true
        });
        core.info(`Devcontainer CLI version '${res.stdout}' is installed.`);
        return res.exitCode === 0;
    } catch (err) {
        return false;
    }
}

export async function ensureDevcontainerCliPresent(cliDebugMode = false): Promise<boolean> {
    if (await isDevcontainerCliAvailable(cliDebugMode)) {
        core.info('devcontainer CLI is already installed');
        return true;
    }

    if (cliDebugMode) {
        core.error('Cannot remotely fetch CLI in debug mode');
        return false;
    }

    try {
        core.info('Fetching the latest @devcontainer/cli...');
        const res = await exec.getExecOutput('npm', ['install', '-g', '@devcontainers/cli'], {
            ignoreReturnCode: true,
            silent: true
        });
        return res.exitCode === 0;
    } catch (err) {
        return false;
    }
}

export async function validateFeatureSchema(pathToAFeatureDir: string): Promise<boolean> {
    const ajv = new Ajv();
    ajv.addSchema(devContainerFeatureSchema);
    const validate = ajv.compile(devContainerFeatureSchema);

    const devContainerFeaturePath = path.join(pathToAFeatureDir, 'devcontainer-feature.json');

    // Read this Feature's devcontainer-feature.json
    if (!fs.existsSync(devContainerFeaturePath)) {
        core.error(`(!) ERR: devcontainer-feature.json not found at path '${devContainerFeaturePath}'.`);
        return false;
    }

    const featureJson = await readLocalFile(devContainerFeaturePath, 'utf8');

    const isValid = validate(JSON.parse(featureJson));
    if (!isValid) {
        core.error(`(!) ERR: '${devContainerFeaturePath}' is not valid:`);

        const output = JSON.stringify(validate.errors, undefined, 4);
        core.info(output);
        return false;
    }

    // No parse errors.
    return true;
}
