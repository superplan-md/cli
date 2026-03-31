import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

const GLOBAL_OVERLAY_CONFIG_PATH = path.join(os.homedir(), '.config', 'superplan', 'config.toml')

async function readConfigContent(): Promise<string> {
  try {
    return await fs.readFile(GLOBAL_OVERLAY_CONFIG_PATH, 'utf-8')
  } catch {
    return ''
  }
}

function parseSectionHeader(line: string): string | null {
  const match = line.trim().match(/^\[([^\]]+)\]$/)
  return match ? match[1].trim() : null
}

function parseBooleanSetting(content: string, sectionName: string, keyName: string): boolean | null {
  let currentSection: string | null = null

  for (const line of content.split(/\r?\n/)) {
    const sectionHeader = parseSectionHeader(line)
    if (sectionHeader) {
      currentSection = sectionHeader
      continue
    }

    if (currentSection !== sectionName) {
      continue
    }

    const match = line.match(new RegExp(`^\\s*${keyName}\\s*=\\s*(true|false)\\s*$`))
    if (!match) {
      continue
    }

    return match[1] === 'true'
  }

  return null
}

function buildUpdatedConfigContent(content: string, sectionName: string, keyName: string, value: boolean): string {
  const lines = content === '' ? [] : content.split(/\r?\n/)
  const settingLine = `${keyName} = ${value ? 'true' : 'false'}`

  if (lines.length === 0) {
    return `version = "0.1"\n\n[${sectionName}]\n${settingLine}\n`
  }

  let currentSection: string | null = null
  let sectionStart = -1
  let sectionEnd = lines.length
  let keyIndex = -1

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const sectionHeader = parseSectionHeader(line)

    if (sectionHeader) {
      if (currentSection === sectionName && sectionEnd === lines.length) {
        sectionEnd = index
      }

      currentSection = sectionHeader
      if (sectionHeader === sectionName && sectionStart === -1) {
        sectionStart = index
      }
      continue
    }

    if (currentSection !== sectionName) {
      continue
    }

    if (new RegExp(`^\\s*${keyName}\\s*=\\s*(true|false)\\s*$`).test(line)) {
      keyIndex = index
    }
  }

  if (sectionStart === -1) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') {
      lines.push('')
    }

    lines.push(`[${sectionName}]`)
    lines.push(settingLine)
    return `${lines.join('\n').replace(/\n*$/, '')}\n`
  }

  if (keyIndex !== -1) {
    lines[keyIndex] = settingLine
    return `${lines.join('\n').replace(/\n*$/, '')}\n`
  }

  lines.splice(sectionEnd, 0, settingLine)
  return `${lines.join('\n').replace(/\n*$/, '')}\n`
}

export async function readGlobalOverlayPreference(): Promise<boolean> {
  const content = await readConfigContent()
  return parseBooleanSetting(content, 'overlay', 'enabled') ?? false
}

export async function writeGlobalOverlayPreference(enabled: boolean): Promise<boolean> {
  const existingContent = await readConfigContent()
  const nextContent = buildUpdatedConfigContent(existingContent, 'overlay', 'enabled', enabled)

  await fs.mkdir(path.dirname(GLOBAL_OVERLAY_CONFIG_PATH), { recursive: true })
  await fs.writeFile(GLOBAL_OVERLAY_CONFIG_PATH, nextContent, 'utf-8')

  return enabled
}
