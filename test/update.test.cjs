const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  loadDistModule,
  makeSandbox,
  pathExists,
  withSandboxEnv,
  writeJson,
} = require('./helpers.cjs');

test('update reruns the bundled installer with recorded install metadata', async () => {
  const sandbox = await makeSandbox('superplan-update-remote-');
  const metadataPath = path.join(sandbox.home, '.config', 'superplan', 'install.json');

  await writeJson(metadataPath, {
    install_method: 'remote_repo',
    repo_url: 'https://github.com/example/custom-superplan.git',
    ref: 'release',
    install_prefix: path.join(sandbox.root, 'prefix'),
    overlay: {
      install_method: 'copied_prebuilt',
      source_path: path.join(sandbox.root, 'overlay-bin'),
      install_dir: path.join(sandbox.home, '.local', 'share', 'superplan', 'overlay'),
      install_path: path.join(sandbox.home, '.local', 'share', 'superplan', 'overlay', 'overlay-bin'),
      executable_path: path.join(sandbox.home, '.local', 'share', 'superplan', 'overlay', 'overlay-bin'),
    },
  });

  await withSandboxEnv(sandbox, async () => {
    const { update } = loadDistModule('cli/commands/update.js');
    const calls = [];

    const result = await update({ json: true, quiet: true }, {
      resolveLatestRelease: async () => ({
        tag: 'release',
        commitish: 'release',
        url: 'https://github.com/example/custom-superplan/releases/tag/release',
      }),
      runInstaller: async (command, args, options) => {
        calls.push({ command, args, env: options.env });
        return {
          code: 0,
          stdout: 'Installed Superplan',
          stderr: '',
        };
      },
      stopManagedProcesses: async () => ({
        stopped: [],
      }),
      refreshSkills: async () => ({
        ok: true,
        data: {
          scope: 'skip',
          refreshed: false,
          agents: [],
          verified: true,
        },
      }),
    });

    assert.deepEqual(result, {
      ok: true,
      data: {
        updated: true,
        install_method: 'remote_repo',
        repo_url: 'https://github.com/example/custom-superplan.git',
        ref: 'release',
        commitish: 'release',
        release_url: 'https://github.com/example/custom-superplan/releases/tag/release',
        install_prefix: path.join(sandbox.root, 'prefix'),
        skills_refreshed: false,
        skills_scope: 'skip',
        stopped_processes: 0,
        next_action: {
          type: 'command',
          command: 'superplan doctor --json',
          reason: 'The CLI and skills were updated, so the next control-plane step is checking that the install is healthy.',
        },
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'sh');
    assert.match(calls[0].args[0], /scripts\/install\.sh$/);
    assert.equal(calls[0].env.SUPERPLAN_REPO_URL, 'https://github.com/example/custom-superplan.git');
    assert.equal(calls[0].env.SUPERPLAN_REF, 'release');
    assert.equal(calls[0].env.SUPERPLAN_INSTALL_PREFIX, path.join(sandbox.root, 'prefix'));
    assert.equal(calls[0].env.SUPERPLAN_OVERLAY_SOURCE_PATH, path.join(sandbox.root, 'overlay-bin'));
    assert.equal(calls[0].env.SUPERPLAN_OVERLAY_INSTALL_DIR, path.join(sandbox.home, '.local', 'share', 'superplan', 'overlay'));
    assert.equal(calls[0].env.SUPERPLAN_RUN_SETUP_AFTER_INSTALL, '0');
  });
});

test('update resolves and installs the latest published release before refreshing skills', async () => {
  const sandbox = await makeSandbox('superplan-update-latest-release-');

  await withSandboxEnv(sandbox, async () => {
    const { update } = loadDistModule('cli/commands/update.js');
    const calls = [];
    const stoppedProcesses = [];

    const result = await update({ json: true, quiet: true }, {
      readInstallMetadata: async () => ({
        install_method: 'remote_repo',
        repo_url: 'https://github.com/example/custom-superplan.git',
        ref: 'alpha.12',
        install_prefix: path.join(sandbox.root, 'prefix'),
        overlay: {
          install_method: 'downloaded_prebuilt',
          release_base_url: 'https://github.com/example/custom-superplan/releases/download/alpha.12',
          install_dir: path.join(sandbox.home, '.local', 'share', 'superplan', 'overlay'),
          install_path: path.join(sandbox.home, '.local', 'share', 'superplan', 'overlay', 'Superplan.app'),
          executable_path: path.join(sandbox.home, '.local', 'share', 'superplan', 'overlay', 'Superplan.app', 'Contents', 'MacOS', 'Superplan'),
        },
      }),
      resolveLatestRelease: async () => ({
        tag: 'alpha.14',
        commitish: 'bea27a2c63f941a99fa6b8afa55348054130fb6f',
        url: 'https://github.com/example/custom-superplan/releases/tag/alpha.14',
      }),
      stopManagedProcesses: async (input) => {
        stoppedProcesses.push(input);
        return {
          stopped: [
            { pid: 101, kind: 'cli', command: '/prefix/bin/superplan run --json' },
            { pid: 202, kind: 'overlay', command: '/overlay/Superplan' },
          ],
        };
      },
      runInstaller: async (command, args, options) => {
        calls.push({ command, args, env: options.env });
        return {
          code: 0,
          stdout: 'Installed Superplan',
          stderr: '',
        };
      },
      refreshSkills: async () => ({
        ok: true,
        data: {
          scope: 'both',
          refreshed: true,
          agents: [],
          verified: true,
        },
      }),
    });

    assert.deepEqual(result, {
      ok: true,
      data: {
        updated: true,
        install_method: 'remote_repo',
        repo_url: 'https://github.com/example/custom-superplan.git',
        ref: 'alpha.14',
        commitish: 'bea27a2c63f941a99fa6b8afa55348054130fb6f',
        release_url: 'https://github.com/example/custom-superplan/releases/tag/alpha.14',
        install_prefix: path.join(sandbox.root, 'prefix'),
        skills_refreshed: true,
        skills_scope: 'both',
        stopped_processes: 2,
        next_action: {
          type: 'command',
          command: 'superplan doctor --json',
          reason: 'The CLI and skills were updated, so the next control-plane step is checking that the install is healthy.',
        },
      },
    });

    assert.equal(stoppedProcesses.length, 1);
    assert.equal(stoppedProcesses[0].installBinDir, path.join(sandbox.root, 'prefix', 'bin'));
    assert.equal(stoppedProcesses[0].overlayExecutablePath, path.join(
      sandbox.home,
      '.local',
      'share',
      'superplan',
      'overlay',
      'Superplan.app',
      'Contents',
      'MacOS',
      'Superplan',
    ));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].env.SUPERPLAN_REF, 'alpha.14');
    assert.equal(calls[0].env.SUPERPLAN_OVERLAY_RELEASE_BASE_URL, 'https://github.com/example/custom-superplan/releases/download/alpha.14');
    assert.equal(calls[0].env.SUPERPLAN_LATEST_COMMITISH, 'bea27a2c63f941a99fa6b8afa55348054130fb6f');
  });
});

test('update pins moving refs to the latest commit and does not reuse stale overlay release urls', async () => {
  const sandbox = await makeSandbox('superplan-update-main-branch-');

  await withSandboxEnv(sandbox, async () => {
    const { update } = loadDistModule('cli/commands/update.js');
    const calls = [];

    const result = await update({ json: true, quiet: true }, {
      readInstallMetadata: async () => ({
        install_method: 'remote_repo',
        repo_url: 'https://github.com/example/custom-superplan.git',
        ref: 'alpha.25',
        install_prefix: path.join(sandbox.root, 'prefix'),
        overlay: {
          install_method: 'downloaded_prebuilt',
          release_base_url: 'https://github.com/example/custom-superplan/releases/download/alpha.25',
          install_dir: path.join(sandbox.home, '.local', 'share', 'superplan', 'overlay'),
        },
      }),
      resolveLatestRelease: async () => ({
        tag: 'main',
        commitish: 'f00dbabe1234567890abcdef1234567890abcd',
        url: 'https://github.com/example/custom-superplan/commit/f00dbabe1234567890abcdef1234567890abcd',
      }),
      runInstaller: async (command, args, options) => {
        calls.push({ command, args, env: options.env });
        return {
          code: 0,
          stdout: 'Installed Superplan',
          stderr: '',
        };
      },
      stopManagedProcesses: async () => ({
        stopped: [],
      }),
      refreshSkills: async () => ({
        ok: true,
        data: {
          scope: 'skip',
          refreshed: false,
          agents: [],
          verified: true,
        },
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].env.SUPERPLAN_REF, 'main');
    assert.equal(calls[0].env.SUPERPLAN_LATEST_COMMITISH, 'f00dbabe1234567890abcdef1234567890abcd');
    assert.equal('SUPERPLAN_OVERLAY_RELEASE_BASE_URL' in calls[0].env, false);
  });
});

test('update fails cleanly when latest commit resolution fails', async () => {
  const sandbox = await makeSandbox('superplan-update-latest-commit-fails-');

  await withSandboxEnv(sandbox, async () => {
    const { update } = loadDistModule('cli/commands/update.js');

    const result = await update({ json: true, quiet: true }, {
      readInstallMetadata: async () => ({
        install_method: 'remote_repo',
        repo_url: 'https://github.com/example/custom-superplan.git',
      }),
      resolveLatestRelease: async () => {
        throw new Error('GitHub latest commit lookup failed');
      },
      runInstaller: async () => {
        throw new Error('installer should not run');
      },
    });

    assert.deepEqual(result, {
      ok: false,
      error: {
        code: 'LATEST_COMMIT_LOOKUP_FAILED',
        message: 'GitHub latest commit lookup failed',
        retryable: true,
      },
    });
  });
});

test('update refreshes installed skills for existing global and local setups', async () => {
  const sandbox = await makeSandbox('superplan-update-refresh-skills-');
  const metadataPath = path.join(sandbox.home, '.config', 'superplan', 'install.json');

  await writeJson(metadataPath, {
    install_method: 'remote_repo',
    repo_url: 'https://github.com/example/custom-superplan.git',
    ref: 'release',
    install_prefix: path.join(sandbox.root, 'prefix'),
  });

  await writeJson(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), {
    version: '0.1',
  });
  await writeJson(path.join(sandbox.cwd, '.superplan', 'config.toml'), {
    version: '0.1',
  });

  await withSandboxEnv(sandbox, async () => {
    const fs = require('node:fs/promises');
    await fs.mkdir(path.join(sandbox.home, '.claude'), { recursive: true });
    await fs.mkdir(path.join(sandbox.home, '.gemini'), { recursive: true });
    await fs.mkdir(path.join(sandbox.cwd, '.codex'), { recursive: true });

    const { update } = loadDistModule('cli/commands/update.js');

    const result = await update({ json: true, quiet: true }, {
      resolveLatestRelease: async () => ({
        tag: 'release',
        commitish: 'release',
        url: 'https://github.com/example/custom-superplan/releases/tag/release',
      }),
      stopManagedProcesses: async () => ({
        stopped: [],
      }),
      runInstaller: async () => ({
        code: 0,
        stdout: 'Installed Superplan',
        stderr: '',
      }),
    });

    assert.deepEqual(result, {
      ok: true,
      data: {
        updated: true,
        install_method: 'remote_repo',
        repo_url: 'https://github.com/example/custom-superplan.git',
        ref: 'release',
        commitish: 'release',
        release_url: 'https://github.com/example/custom-superplan/releases/tag/release',
        install_prefix: path.join(sandbox.root, 'prefix'),
        skills_refreshed: true,
        skills_scope: 'both',
        stopped_processes: 0,
        next_action: {
          type: 'command',
          command: 'superplan doctor --json',
          reason: 'The CLI and skills were updated, so the next control-plane step is checking that the install is healthy.',
        },
      },
    });

    assert.equal(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-release', 'SKILL.md')), true);
    assert.equal(await pathExists(path.join(sandbox.home, '.claude', 'CLAUDE.md')), true);
    assert.equal(await pathExists(path.join(sandbox.home, '.gemini', 'skills', 'superplan-release', 'SKILL.md')), true);
    assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'skills', 'superplan-release', 'SKILL.md')), true);
    assert.equal(await pathExists(path.join(sandbox.cwd, '.codex')), true);
  });
});

test('update refuses to mutate local source installs automatically', async () => {
  const sandbox = await makeSandbox('superplan-update-local-');
  const metadataPath = path.join(sandbox.home, '.config', 'superplan', 'install.json');

  await writeJson(metadataPath, {
    install_method: 'local_source',
    source_dir: '/tmp/superplan-source',
    install_prefix: path.join(sandbox.root, 'prefix'),
  });

  await withSandboxEnv(sandbox, async () => {
    const { update } = loadDistModule('cli/commands/update.js');

    const result = await update({ json: true, quiet: true }, {
      runInstaller: async () => {
        throw new Error('installer should not run for local source installs');
      },
    });

    assert.deepEqual(result, {
      ok: false,
      error: {
        code: 'LOCAL_SOURCE_UPDATE_UNSUPPORTED',
        message: 'Local source installs should be updated from the source checkout and reinstalled explicitly',
        retryable: false,
      },
    });
  });
});
