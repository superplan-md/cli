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
        install_prefix: path.join(sandbox.root, 'prefix'),
        skills_refreshed: false,
        skills_scope: 'skip',
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
    await fs.mkdir(path.join(sandbox.cwd, '.codex'), { recursive: true });

    const { update } = loadDistModule('cli/commands/update.js');

    const result = await update({ json: true, quiet: true }, {
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
        install_prefix: path.join(sandbox.root, 'prefix'),
        skills_refreshed: true,
        skills_scope: 'both',
      },
    });

    assert.equal(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'skills', 'release-readiness', 'SKILL.md')), true);
    assert.equal(await pathExists(path.join(sandbox.home, '.claude', 'skills', 'release-readiness', 'SKILL.md')), true);
    assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'skills', 'release-readiness', 'SKILL.md')), true);
    assert.equal(await pathExists(path.join(sandbox.cwd, '.codex', 'skills', 'release-readiness', 'SKILL.md')), true);
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
