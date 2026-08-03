// Preferences API client for the runtime versioned-variable endpoint.
//
// The workflow API is mounted below /v1/comfy while preferences are mounted
// below /v1/preferences. The URL builder therefore keeps the configured host
// and port but deliberately replaces the dashboard route with the preference
// route.

import { isObject, objectEach } from '@presource/core';

// Each top-level preference name maps to arbitrary version labels and values.
// The server accepts any version key, so the client must not narrow this map to
// only the conventional "current" or "stable" labels.
export type PreferenceVariableVersions = Record<string, unknown>;
export type PreferenceVariables = Record<string, PreferenceVariableVersions>;

// Convert a decoded response into the safe object shape consumed by the UI.
// Invalid server data is treated as an empty map instead of making the dialog
// crash while rendering rows.
export const normalizePreferenceVariables = (value: unknown): PreferenceVariables => {
    if (!isObject(value)) return {};

    const variables: PreferenceVariables = {};
    objectEach(value, ({ key, value: variable }) => {
        if (isObject(variable)) {
            variables[key] = variable as PreferenceVariableVersions;
        }
    });
    return variables;
};

// Build the endpoint using an absolute base URL when possible. The fallback
// keeps relative Vite/test URLs usable and preserves the host/port behavior of
// the normal absolute dashboard configuration.
export const preferenceVariablesUrl = (baseUrl: string, profile = ''): string => {
    let endpoint: string;
    try {
        endpoint = new URL('/v1/preferences/variables', baseUrl).toString();
    } catch {
        const dashboardRoute = /\/v1\/comfy\/?$/.test(baseUrl)
            ? baseUrl.replace(/\/v1\/comfy\/?$/, '')
            : baseUrl.replace(/\/+$/, '');
        endpoint = `${dashboardRoute}/v1/preferences/variables`;
    }

    const selectedProfile = profile.trim();
    return selectedProfile
        ? `${endpoint}?profile=${encodeURIComponent(selectedProfile)}`
        : endpoint;
};

// Read an API error body when available, while keeping the HTTP status as a
// useful fallback for network responses that do not contain JSON.
const preferenceResponseError = async (response: Response, action: string): Promise<Error> => {
    let message = `${action} (HTTP ${response.status})`;
    try {
        const data = await response.json() as { error?: unknown };
        if (typeof data.error === 'string' && data.error) message = data.error;
    } catch {
        // A non-JSON error body does not change the stable status-based message.
    }
    return new Error(message);
};

// Fetch one profile. An empty profile intentionally omits the query parameter
// so the runtime endpoint selects its default.json document.
export async function fetchPreferenceVariables(
    baseUrl: string,
    profile = ''
): Promise<PreferenceVariables> {
    const response = await fetch(preferenceVariablesUrl(baseUrl, profile));
    if (!response.ok) throw await preferenceResponseError(response, 'Failed to fetch preferences');
    return normalizePreferenceVariables(await response.json());
}

// Add versioned values to one profile. The runtime endpoint deep-merges this
// object and returns the complete resulting profile document.
export async function addPreferenceVariables(
    baseUrl: string,
    variables: PreferenceVariables,
    profile = ''
): Promise<PreferenceVariables> {
    const response = await fetch(preferenceVariablesUrl(baseUrl, profile), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variables)
    });
    if (!response.ok) throw await preferenceResponseError(response, 'Failed to save preferences');
    return normalizePreferenceVariables(await response.json());
}
