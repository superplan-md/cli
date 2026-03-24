import { PostHog } from 'posthog-node';
import { readTelemetryConfig, writeTelemetryConfig, generateMachineId } from './telemetry-preferences';

// Replaced with a real key during build or through environment variables
const POSTHOG_API_KEY = process.env.SUPERPLAN_POSTHOG_KEY || 'phc_dummy_key_for_dev';
const POSTHOG_HOST = 'https://app.posthog.com';

let posthogClient: PostHog | null = null;

function getPostHog(): PostHog {
  if (!posthogClient) {
    posthogClient = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
  }
  return posthogClient;
}

export async function captureEvent(eventName: string, properties: Record<string, any> = {}): Promise<void> {
  const config = await readTelemetryConfig();

  // Don't track if the user has explicitly opt-out
  if (config.enabled === false) {
    return;
  }

  // Generate and store machine ID if missing (we still track anonymously even if the user hasn't explicitly opted in yet,
  // until they say 'no' during init).
  let machineId = config.machineId;
  if (!machineId) {
    machineId = generateMachineId();
    await writeTelemetryConfig({ machineId });
  }

  try {
    getPostHog().capture({
      distinctId: machineId,
      event: eventName,
      properties: {
        ...properties,
        $os: process.platform,
        $lib: 'superplan-cli',
        node_version: process.version,
      },
    });
  } catch (error) {
    // Silently fail to not affect the CLI user experience
  }
}

export async function flushTelemetry(): Promise<void> {
  if (posthogClient) {
    await posthogClient.shutdown();
  }
}
