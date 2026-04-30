const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const https = require('node:https');
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
  const overlaySourcePath = path.join(sandbox.root, 'overlay-bin');

  await fs.mkdir(overlaySourcePath, { recursive: true });

  await writeJson(metadataPath, {
    install_method: 'remote_repo',
    repo_url: 'https://github.com/example/custom-superplan.git',
    ref: 'release',
    install_prefix: path.join(sandbox.root, 'prefix'),
    overlay: {
      install_method: 'copied_prebuilt',
      source_path: overlaySourcePath,
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
        calls.push({ command, args, env: options.env, streamOutput: options.streamOutput });
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
    assert.equal(calls[0].env.SUPERPLAN_OVERLAY_SOURCE_PATH, overlaySourcePath);
    assert.equal(calls[0].env.SUPERPLAN_OVERLAY_INSTALL_DIR, path.join(sandbox.home, '.local', 'share', 'superplan', 'overlay'));
    assert.equal(calls[0].env.SUPERPLAN_RUN_SETUP_AFTER_INSTALL, '0');
    assert.equal(calls[0].streamOutput, false);
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
        calls.push({ command, args, env: options.env, streamOutput: options.streamOutput });
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
    assert.equal(calls[0].streamOutput, false);
  });
});

test('update resolves the latest alpha release by default for alpha installs', async () => {
  const sandbox = await makeSandbox('superplan-update-default-alpha-track-');

  await withSandboxEnv(sandbox, async () => {
    const { update } = loadDistModule('cli/commands/update.js');
    const calls = [];
    const requestPaths = [];
    const originalGet = https.get;

    https.get = (options, handler) => {
      requestPaths.push(options.path);

      const request = new EventEmitter();
      process.nextTick(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.setEncoding = () => {};
        handler(response);
        response.emit('data', JSON.stringify([
          {
            tag_name: 'alpha.14',
            html_url: 'https://github.com/example/custom-superplan/releases/tag/alpha.14',
            target_commitish: 'oldalpha',
          },
          {
            tag_name: 'alpha.16',
            html_url: 'https://github.com/example/custom-superplan/releases/tag/alpha.16',
            target_commitish: 'newalpha',
          },
          {
            tag_name: 'v1.0.0',
            html_url: 'https://github.com/example/custom-superplan/releases/tag/v1.0.0',
            target_commitish: 'stable',
          },
        ]));
        response.emit('end');
      });

      return request;
    };

    try {
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
          },
        }),
        runInstaller: async (command, args, options) => {
          calls.push({ command, args, env: options.env, streamOutput: options.streamOutput });
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
      assert.equal(result.data.ref, 'alpha.16');
      assert.equal(result.data.commitish, 'newalpha');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].env.SUPERPLAN_REF, 'alpha.16');
      assert.equal(calls[0].env.SUPERPLAN_LATEST_COMMITISH, 'newalpha');
      assert.equal(calls[0].env.SUPERPLAN_OVERLAY_RELEASE_BASE_URL, 'https://github.com/example/custom-superplan/releases/download/alpha.16');
      assert.deepEqual(requestPaths, ['/repos/example/custom-superplan/releases?per_page=100']);
    } finally {
      https.get = originalGet;
    }
  });
});

test('update falls back to the installed overlay bundle when a copied prebuilt source path is stale', async () => {
  const sandbox = await makeSandbox('superplan-update-overlay-fallback-');
  const installedOverlayPath = path.join(
    sandbox.home,
    '.local',
    'share',
    'superplan',
    'overlay',
    'Superplan.app',
  );

  await fs.mkdir(installedOverlayPath, { recursive: true });

  await withSandboxEnv(sandbox, async () => {
    const { update } = loadDistModule('cli/commands/update.js');
    const calls = [];

    const result = await update({ json: true, quiet: true }, {
      readInstallMetadata: async () => ({
        install_method: 'remote_repo',
        repo_url: 'https://github.com/example/custom-superplan.git',
        ref: 'main',
        install_prefix: path.join(sandbox.root, 'prefix'),
        overlay: {
          install_method: 'copied_prebuilt',
          source_path: path.join(sandbox.root, 'missing-overlay.tar.gz'),
          install_dir: path.join(sandbox.home, '.local', 'share', 'superplan', 'overlay'),
          install_path: installedOverlayPath,
          executable_path: path.join(installedOverlayPath, 'Contents', 'MacOS', 'Superplan'),
        },
      }),
      resolveLatestRelease: async () => ({
        tag: 'main',
        commitish: 'f00dbabe1234567890abcdef1234567890abcd',
        url: 'https://github.com/example/custom-superplan/commit/f00dbabe1234567890abcdef1234567890abcd',
      }),
      stopManagedProcesses: async () => ({
        stopped: [],
      }),
      runInstaller: async (command, args, options) => {
        calls.push({ command, args, env: options.env, streamOutput: options.streamOutput });
        return {
          code: 0,
          stdout: 'Installed Superplan',
          stderr: '',
        };
      },
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
    assert.equal(calls[0].env.SUPERPLAN_OVERLAY_SOURCE_PATH, installedOverlayPath);
  });
});

test('update emits progress messages and streams installer output when not quiet', async () => {
  const sandbox = await makeSandbox('superplan-update-progress-');

  await withSandboxEnv(sandbox, async () => {
    const { update } = loadDistModule('cli/commands/update.js');
    const progress = [];
    const calls = [];

    const result = await update({ json: true, quiet: false }, {
      readInstallMetadata: async () => ({
        install_method: 'remote_repo',
        repo_url: 'https://github.com/example/custom-superplan.git',
        ref: 'alpha.25',
        install_prefix: path.join(sandbox.root, 'prefix'),
      }),
      resolveLatestRelease: async () => ({
        tag: 'main',
        commitish: 'f00dbabe1234567890abcdef1234567890abcd',
        url: 'https://github.com/example/custom-superplan/commit/f00dbabe1234567890abcdef1234567890abcd',
      }),
      stopManagedProcesses: async () => ({
        stopped: [],
      }),
      runInstaller: async (command, args, options) => {
        calls.push({ command, args, env: options.env, streamOutput: options.streamOutput });
        return {
          code: 0,
          stdout: 'Installed Superplan',
          stderr: '',
        };
      },
      refreshSkills: async () => ({
        ok: true,
        data: {
          scope: 'skip',
          refreshed: false,
          agents: [],
          verified: true,
        },
      }),
      reportProgress: (message) => {
        progress.push(message);
      },
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].streamOutput, true);
    assert.deepEqual(progress, [
      'Checking latest available Superplan source...',
      'Preparing update from main (f00dbabe1234)...',
      'Stopping running Superplan processes...',
      'Running installer...',
      'Refreshing installed skills...',
      'Update complete.',
    ]);
  });
});

test('update renders an in-place progress bar on interactive terminals', async () => {
  const sandbox = await makeSandbox('superplan-update-progress-bar-');

  await withSandboxEnv(sandbox, async () => {
    const { update } = loadDistModule('cli/commands/update.js');
    const calls = [];
<<<<<<< HEAD
    let stderrOutput = '';
    const originalWrite = process.stderr.write.bind(process.stderr);
    const originalIsTTY = process.stderr.isTTY;

    Object.defineProperty(process.stderr, 'isTTY', {
      configurable: true,
      value: true,
    });
    process.stderr.write = ((chunk) => {
      stderrOutput += String(chunk);
=======
    let stdoutOutput = '';
    const originalWrite = process.stdout.write.bind(process.stdout);
    const originalIsTTY = process.stdout.isTTY;

    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true,
    });
    process.stdout.write = ((chunk) => {
      stdoutOutput += String(chunk);
>>>>>>> fd2110acbd9ee7654a8f2be078802af20924c678
      return true;
    });

    try {
      const result = await update({ quiet: false }, {
        readInstallMetadata: async () => ({
          install_method: 'remote_repo',
          repo_url: 'https://github.com/example/custom-superplan.git',
          ref: 'main',
          install_prefix: path.join(sandbox.root, 'prefix'),
        }),
        resolveLatestRelease: async () => ({
          tag: 'main',
          commitish: 'f00dbabe1234567890abcdef1234567890abcd',
          url: 'https://github.com/example/custom-superplan/commit/f00dbabe1234567890abcdef1234567890abcd',
        }),
        stopManagedProcesses: async () => ({
          stopped: [],
        }),
        runInstaller: async (command, args, options) => {
          calls.push({ command, args, env: options.env, streamOutput: options.streamOutput });
          return {
            code: 0,
            stdout: 'Installed Superplan',
            stderr: '',
          };
        },
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
      assert.equal(calls[0].streamOutput, false);
<<<<<<< HEAD
      assert.match(stderrOutput, /\[##------------------\]\s+10% Checking latest available Superplan source\.\.\./);
      assert.match(stderrOutput, /\[#############-------\]\s+65% Running installer\.\.\./);
      assert.match(stderrOutput, /\[####################\]\s+100% Update complete\./);
      assert.match(stderrOutput, /\r/);
      assert.match(stderrOutput, /\n$/);
    } finally {
      process.stderr.write = originalWrite;
      Object.defineProperty(process.stderr, 'isTTY', {
=======
      assert.match(stdoutOutput, /\[##------------------\]\s+10% Checking latest available Superplan source\.\.\./);
      assert.match(stdoutOutput, /\[#############-------\]\s+65% Running installer\.\.\./);
      assert.match(stdoutOutput, /\[####################\]\s+100% Update complete\./);
      assert.match(stdoutOutput, /\r/);
      assert.match(stdoutOutput, /\n$/);
    } finally {
      process.stdout.write = originalWrite;
      Object.defineProperty(process.stdout, 'isTTY', {
>>>>>>> fd2110acbd9ee7654a8f2be078802af20924c678
        configurable: true,
        value: originalIsTTY,
      });
    }
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
        calls.push({ command, args, env: options.env, streamOutput: options.streamOutput });
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
