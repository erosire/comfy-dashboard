// Preferences API client tests.
//
// These tests pin the exact host/path/query construction and the JSON request
// body used by the runtime endpoint. No real server is contacted.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_AREA_NETWORK_HOST_NAME, LOCAL_AREA_NETWORK_DATABASE_PORT } from '@config/environment';
import {
    addPreferenceVariables,
    fetchPreferenceVariables,
    normalizePreferenceVariables,
    preferenceVariablesUrl
} from './preferences';

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('preferenceVariablesUrl', () => {
    it('keeps the configured host and port while switching to the preferences route', () => {
        expect(preferenceVariablesUrl(`http://${LOCAL_AREA_NETWORK_HOST_NAME}:${LOCAL_AREA_NETWORK_DATABASE_PORT}/v1/comfy`)).toBe(
            `http://${LOCAL_AREA_NETWORK_HOST_NAME}:${LOCAL_AREA_NETWORK_DATABASE_PORT}/v1/preferences/variables`
        );
    });

    it('omits a blank profile and encodes a named profile as a query value', () => {
        expect(preferenceVariablesUrl('http://dashboard.example:8123/v1/comfy', '   ')).toBe(
            'http://dashboard.example:8123/v1/preferences/variables'
        );
        expect(preferenceVariablesUrl('http://dashboard.example:8123/v1/comfy', 'alice / office')).toBe(
            'http://dashboard.example:8123/v1/preferences/variables?profile=alice%20%2F%20office'
        );
    });

    it('supports a relative dashboard URL for browser and test harness callers', () => {
        expect(preferenceVariablesUrl('/v1/comfy')).toBe('/v1/preferences/variables');
    });
});

describe('fetchPreferenceVariables', () => {
    it('GETs the default profile without a profile query and preserves custom version keys', async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({
                theme: { current: 'dark', release_2026: 'dark-blue' },
                autosave: { current: true }
            }), { status: 200 })
        );

        await expect(fetchPreferenceVariables('http://host:5000/v1/comfy')).resolves.toEqual({
            theme: { current: 'dark', release_2026: 'dark-blue' },
            autosave: { current: true }
        });
        expect(vi.mocked(fetch).mock.calls).toEqual([
            ['http://host:5000/v1/preferences/variables']
        ]);
    });

    it('GETs a selected profile and rejects an HTTP error using the API message', async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ error: 'Profile does not exist' }), { status: 400 })
        );

        await expect(fetchPreferenceVariables('http://host:5000/v1/comfy', 'alice')).rejects.toThrow(
            'Profile does not exist'
        );
        expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
            'http://host:5000/v1/preferences/variables?profile=alice'
        );
    });
});

describe('addPreferenceVariables', () => {
    it('PUTs arbitrary version labels and returns the complete merged response', async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({
                theme: { current: 'dark', stable: 'dark', beta_7: 'light' }
            }), { status: 200 })
        );
        const variables = {
            theme: { beta_7: 'light' }
        };

        await expect(addPreferenceVariables('http://host:5000/v1/comfy', variables, 'alice')).resolves.toEqual({
            theme: { current: 'dark', stable: 'dark', beta_7: 'light' }
        });
        expect(vi.mocked(fetch).mock.calls[0]).toEqual([
            'http://host:5000/v1/preferences/variables?profile=alice',
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(variables)
            }
        ]);
    });
});

describe('normalizePreferenceVariables', () => {
    it('keeps only object-shaped variables and returns an empty map for invalid roots', () => {
        expect(normalizePreferenceVariables({
            valid: { custom: 'value' },
            invalid: 'scalar'
        })).toEqual({ valid: { custom: 'value' } });
        expect(normalizePreferenceVariables([])).toEqual({});
        expect(normalizePreferenceVariables(null)).toEqual({});
    });
});
