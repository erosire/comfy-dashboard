// Prompt preference variables — replaces `{{name}}` tokens in the workflow
// snapshot with the user's saved preference values before submission.
//
// The ComfyUI-generic half of the old module (workflow → API prompt
// assembly, bypass rejoin, subgraph flattening) now lives in
// `@underload/comfy` (src/comfy/workflow-prompt.ts) — import
// `workflowToApiPrompt` / `editorTreeToApiPrompt` / `uiNodesToApiPrompt` /
// `flattenSubgraphNodes` from '@underload/comfy'.

import {
    isBoolean,
    isInvalid,
    isNumber,
    isObject,
    isString,
    jsonStringify,
    objectEach,
    objectHasKey,
    toString
} from '@presource/core';

// Preference API responses are version maps (`{ current: value }`), while the
// resolver also accepts scalar values so callers can compile a prompt from a
// small in-memory map without first wrapping every value in `current`.
export type PromptPreferences = Record<string, unknown>;

// Only balanced double-brace tokens are variables. Invalid or unmatched braces
// are left alone because they are ordinary user text rather than a variable
// declaration that this compiler can resolve safely.
const PREFERENCE_TOKEN_PATTERN = /\{\{([^{}]+)\}\}/g;
const COMPLETE_PREFERENCE_TOKEN_PATTERN = /^\{\{([^{}]+)\}\}$/;

// Read the value selected for one preference variable. `current` is the
// canonical version; when it is absent, the first persisted version is used so
// profiles containing only a custom revision still provide a deterministic
// replacement. A missing or null variable resolves to the required empty text.
const readPromptPreference = (
    preferences: PromptPreferences,
    name: string
): { exists: boolean; value: unknown } => {
    if (!objectHasKey(preferences, name)) return { exists: false, value: '' };

    const configured = preferences[name];
    if (isInvalid(configured)) return { exists: false, value: '' };
    if (!isObject(configured)) return { exists: true, value: configured };

    if (objectHasKey(configured, 'current')) {
        const current = configured.current;
        return isInvalid(current) ? { exists: false, value: '' } : { exists: true, value: current };
    }

    let firstVersion: unknown;
    let hasVersion = false;
    objectEach(configured, ({ value }) => {
        if (!hasVersion) {
            firstVersion = value;
            hasVersion = true;
        }
    });
    return hasVersion && !isInvalid(firstVersion)
        ? { exists: true, value: firstVersion }
        : { exists: false, value: '' };
};

// Convert a resolved non-string value into text when it is embedded inside a
// larger string. JSON encoding keeps objects and arrays valid rather than
// producing the unhelpful `[object Object]` token in a prompt field.
const promptReplacementText = (value: unknown): string => {
    if (isInvalid(value)) return '';
    if (isString(value)) return value;
    if (isNumber(value) || isBoolean(value)) return toString(value);
    try {
        return jsonStringify(value) ?? '';
    } catch {
        // Cyclic or otherwise non-serializable preference values cannot be
        // represented in a JSON payload, so the same safe fallback as a
        // missing preference prevents invalid prompt data from escaping.
        return '';
    }
};

// Resolve a preference value recursively. This handles a preference referring
// to another preference and breaks cycles by replacing the cyclic edge with an
// empty string, guaranteeing that resolved prompt strings contain no tokens
// introduced by another preference value.
const resolvePromptValue = (
    value: unknown,
    preferences: PromptPreferences,
    resolving: Set<string>
): unknown => {
    if (isString(value)) {
        const complete = value.match(COMPLETE_PREFERENCE_TOKEN_PATTERN);
        if (complete) {
            const name = complete[1].trim();
            const preference = readPromptPreference(preferences, name);
            if (!preference.exists || resolving.has(name)) return '';
            const nextResolving = new Set(resolving);
            nextResolving.add(name);
            return resolvePromptValue(preference.value, preferences, nextResolving);
        }

        return value.replace(PREFERENCE_TOKEN_PATTERN, (_token, rawName: string) => {
            const name = rawName.trim();
            const preference = readPromptPreference(preferences, name);
            if (!preference.exists || resolving.has(name)) return '';
            const nextResolving = new Set(resolving);
            nextResolving.add(name);
            return promptReplacementText(resolvePromptValue(preference.value, preferences, nextResolving));
        });
    }

    if (Array.isArray(value)) {
        return value.map((item) => resolvePromptValue(item, preferences, resolving));
    }

    if (isObject(value)) {
        const resolved: Record<string, unknown> = {};
        objectEach(value, ({ key, value: nested }) => {
            // JSON object keys are always strings, so object-valued key
            // replacements are encoded in the same safe form as embedded text.
            const resolvedKey = resolvePromptValue(key, preferences, resolving);
            resolved[promptReplacementText(resolvedKey)] = resolvePromptValue(nested, preferences, resolving);
        });
        return resolved;
    }

    // Numbers, booleans, and null-free JSON primitives are already valid JSON
    // values and must retain their type when they are the complete token.
    return value;
};

// Replace every preference token in a JSON-compatible value. The recursive
// result is a fresh structure, so compiling a prompt never mutates the saved
// workflow snapshot or the editor's node tree.
export const replacePreferenceVariables = <T>(
    value: T,
    preferences: PromptPreferences = {}
): T => resolvePromptValue(value, preferences, new Set()) as T;
