import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export interface OverlayInstallMetadata {
  install_method?: 'copied_prebuilt' | 'downloaded_prebuilt';
  source_path?: string;
  asset_name?: string;
  release_base_url?: string;
  install_dir?: string;
  install_path?: string;
  executable_path?: string;
  executable_relative_path?: string;
  platform?: string;
  arch?: string;
  installed_at?: string;
}

export interface InstallMetadata {
  install_method?: 'remote_repo' | 'local_source';
  repo_url?: string;
  ref?: string;
  install_prefix?: string;
  install_bin?: string;
  source_dir?: string;
  installed_at?: string;
  overlay?: OverlayInstallMetadata | null;
}

export function getInstallMetadataPath(): string {
  return path.join(os.homedir(), '.config', 'superplan', 'install.json');
}

export async function readInstallMetadata(): Promise<InstallMetadata | null> {
  try {
    const content = await fs.readFile(getInstallMetadataPath(), 'utf-8');
    return JSON.parse(content) as InstallMetadata;
  } catch {
    return null;
  }
}
