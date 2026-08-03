// PreferencesDialog — editor for the runtime's profile-scoped, versioned
// preference variables.
//
// The endpoint stores `{ variableName: { versionKey: value } }`. The compact
// editor shows one selected version at a time, while its dropdown retains every
// arbitrary key returned by the runtime.

import React from 'react';
import { arrayEach, dataClone, objectEach } from '@presource/core';
import { styledComponent } from '@presource/react';
import {
    addPreferenceVariables,
    fetchPreferenceVariables,
    type PreferenceVariableVersions,
    type PreferenceVariables
} from '../../../api';
import { theme } from '../../../styles';
import { AutoGrowTextarea, type AutoGrowTextareaProps } from './AutoGrowTextarea';
import { Btn, BtnPrimary } from './ui';

// A draft is intentionally separate from the API map: text-area values need to
// remain strings while the user is editing, even when a saved value is JSON.
type PreferenceVersionDraft = {
    key: string;
    value: string;
};

type PreferenceDraft = {
    name: string;
    versions: PreferenceVersionDraft[];
};

// Unsaved edits live in this module-level browser-memory cache. It survives
// closing/reopening the dialog during the current UI session, but a full page
// reload clears it so the next session starts from the persisted API document.
const preferenceDraftMemory = new Map<string, PreferenceDraft[]>();
const preferenceVersionMemory = new Map<string, string[]>();

// Tests and embedding hosts can clear the session cache without touching the
// persisted runtime profile; normal UI flows leave this cache untouched.
export const clearPreferenceDraftMemory = (): void => {
    preferenceDraftMemory.clear();
    preferenceVersionMemory.clear();
};

// Blank profile and an explicitly named default profile address separate API
// query choices, so the same distinction is retained by the local cache.
const preferenceMemoryKey = (profile: string): string => profile.trim() || '__default__';

// Clone cached rows so the state editor cannot mutate the memory snapshot by
// reference while a controlled input is being edited.
const clonePreferenceDrafts = (drafts: PreferenceDraft[]): PreferenceDraft[] =>
    dataClone(drafts) as PreferenceDraft[];

// Reuse a remembered dropdown key only when the loaded profile still contains
// it; otherwise the first available version is the deterministic fallback.
const rememberedVersionKeys = (
    drafts: PreferenceDraft[],
    remembered: string[] | undefined
): string[] => drafts.map((draft, index) => {
    const preferred = remembered?.[index];
    return preferred && draft.versions.some((version) => version.key === preferred)
        ? preferred
        : draft.versions[0]?.key ?? '';
});

// ── Dialog layout styles ─────────────────────────────────────────────────
// These wrappers keep all panel/layout CSS in reusable styled components rather
// than scattering inline style objects through the JSX tree.

const PreferencesOverlay = styledComponent('div', {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    boxSizing: 'border-box',
    backgroundColor: 'rgba(0, 0, 0, 0.58)'
});

const PreferencesPanel = styledComponent('div', {
    display: 'flex',
    flexDirection: 'column',
    width: 'min(860px, 100%)',
    // Reserve the overlay padding inside the viewport so the panel and its
    // internal scroll region never extend below a mobile browser's chrome.
    height: 'calc(100vh - 24px)',
    maxHeight: 'calc(100dvh - 24px)',
    minHeight: 0,
    boxSizing: 'border-box',
    overflow: 'hidden',
    backgroundColor: theme.bg,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusLg,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
});

const PreferencesHeader = styledComponent('div', {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '18px 20px 12px',
    flex: '0 0 auto',
    borderBottom: `1px solid ${theme.border}`
});

const PreferencesTitle = styledComponent('div', {
    fontSize: theme.fontSize.lg,
    fontWeight: 650,
    color: theme.text
});

// The explicit close control performs the same callback as the backdrop so
// keyboard and touch users have a visible dismissal affordance.
const CloseButton = styledComponent('button', {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    flex: '0 0 auto',
    padding: 0,
    fontSize: theme.fontSize.xl,
    lineHeight: 1,
    color: theme.textMuted,
    backgroundColor: 'transparent',
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusSm,
    cursor: 'pointer'
}) as unknown as React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>>;

const ProfileBar = styledComponent('div', {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    padding: '12px 20px',
    flex: '0 0 auto',
    backgroundColor: theme.surface1,
    borderBottom: `1px solid ${theme.border}`
});

const ProfileInput = styledComponent('input', {
    flex: '1 1 180px',
    minWidth: 150,
    padding: '6px 9px',
    boxSizing: 'border-box',
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontMono,
    color: theme.text,
    backgroundColor: theme.surface3,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusSm,
    outline: 'none'
}) as unknown as React.FC<React.InputHTMLAttributes<HTMLInputElement>>;

const PreferencesScroll = styledComponent('div', {
    flex: '1 1 auto',
    minHeight: 0,
    overflowY: 'auto',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10
});

const PreferenceCard = styledComponent('div', {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: 8,
    backgroundColor: theme.surface1,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusMd
});

const PreferenceCardHeader = styledComponent('div', {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
});

const PreferenceNameInput = styledComponent('input', {
    flex: '1 1 auto',
    minWidth: 0,
    padding: '6px 8px',
    boxSizing: 'border-box',
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontMono,
    fontWeight: 600,
    color: theme.text,
    backgroundColor: theme.surface3,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusSm,
    outline: 'none'
}) as unknown as React.FC<React.InputHTMLAttributes<HTMLInputElement>>;

const VersionList = styledComponent('div', {
    display: 'flex',
    flexDirection: 'column',
    gap: 4
});

const VersionRow = styledComponent('div', {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6
});

const VersionRowHeader = styledComponent('div', {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    flex: '0 0 20%',
    minWidth: 0,
    gap: 8
});

const VersionKeySelect = styledComponent('select', {
    flex: '1 1 auto',
    width: '100%',
    minWidth: 0,
    padding: '4px 7px',
    boxSizing: 'border-box',
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontMono,
    color: theme.accent2,
    backgroundColor: theme.surface2,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusSm,
    outline: 'none'
}) as unknown as React.FC<React.SelectHTMLAttributes<HTMLSelectElement>>;

// The shared AutoGrowTextarea starts at one row and grows when Enter inserts a
// newline. The six-row cap keeps the preference card compact while overflow
// remains scrollable for longer values.
const PreferenceValueTextarea = styledComponent(AutoGrowTextarea, {
    display: 'block',
    flex: '1 1 auto',
    width: 'auto',
    minWidth: 0,
    minHeight: 0,
    maxHeight: 'calc(6 * 1.4em + 6px)',
    padding: '3px 6px',
    boxSizing: 'border-box',
    overflowY: 'auto',
    fontFamily: theme.fontMono,
    fontSize: theme.fontSize.xs,
    lineHeight: 1.4,
    whiteSpace: 'pre-wrap',
    color: theme.text,
    backgroundColor: theme.surface3,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusSm,
    outline: 'none'
}) as unknown as React.FC<AutoGrowTextareaProps>;

// Plus is intentionally small so adding a version does not make the compact
// preference header look like a second action bar.
const AddVersionButton = styledComponent('button', {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    flex: '0 0 auto',
    padding: 0,
    fontSize: theme.fontSize.xl,
    lineHeight: 1,
    color: theme.textMuted,
    backgroundColor: theme.surface1,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusSm,
    cursor: 'pointer'
}) as unknown as React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>>;

// Keep the add action in the scrollable preference list so it remains directly
// after the rows it creates, including when the profile starts empty. The
// border-box sizing makes the 100% width include the button's padding/border.
const AddPreferenceButton = styledComponent('button', {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    flex: '0 0 auto',
    padding: '8px 14px',
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.textMuted,
    backgroundColor: theme.surface1,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusMd,
    cursor: 'pointer'
}) as unknown as React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>>;

const DialogMessage = styledComponent('div', {
    flex: '0 0 auto',
    padding: '0 20px 10px',
    fontSize: theme.fontSize.sm,
    color: theme.warning,
    lineHeight: 1.4
});

const DialogActions = styledComponent('div', {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    padding: '12px 20px 16px',
    flex: '0 0 auto',
    borderTop: `1px solid ${theme.border}`
});

const DialogActionGroup = styledComponent('div', {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
});

// ── API/draft conversion helpers ───────────────────────────────────────

// Textareas display strings directly and JSON-encode non-string API values so
// booleans, numbers, arrays, null, and objects survive a load/save round trip.
export const preferenceValueToText = (value: unknown): string => {
    if (typeof value === 'string') return value;
    const encoded = JSON.stringify(value, null, 2);
    return encoded === undefined ? '' : encoded;
};

// Plain text remains a string; valid JSON keeps its original primitive/object
// type. This lets the editor support both human text and arbitrary API values.
export const preferenceTextToValue = (value: string): unknown => {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
};

// Expand the API's ordered object map into rows while retaining every custom
// version key and value exactly as the server returned them.
export const preferenceVariablesToDrafts = (variables: PreferenceVariables): PreferenceDraft[] => {
    const drafts: PreferenceDraft[] = [];
    objectEach(variables, ({ key, value: versions }) => {
        const versionDrafts: PreferenceVersionDraft[] = [];
        objectEach(versions, ({ key: versionKey, value }) => {
            versionDrafts.push({ key: versionKey, value: preferenceValueToText(value) });
        });
        // An empty version object is legal on the API, but the editor still
        // needs one row so the user can add a value without a second action.
        if (versionDrafts.length === 0) versionDrafts.push({ key: 'current', value: '' });
        drafts.push({ name: key, versions: versionDrafts });
    });
    return drafts;
};

// Convert edited rows back to the API contract. Validation is performed before
// this helper is called, so empty names cannot silently overwrite another row.
export const draftsToPreferenceVariables = (drafts: PreferenceDraft[]): PreferenceVariables => {
    const variables: PreferenceVariables = {};
    arrayEach(drafts, ({ value: draft }) => {
        const versions: PreferenceVariableVersions = {};
        arrayEach(draft.versions, ({ value: version }) => {
            versions[version.key.trim()] = preferenceTextToValue(version.value);
        });
        variables[draft.name.trim()] = versions;
    });
    return variables;
};

// Return a stable validation message for the first invalid row. Duplicate keys
// are rejected because the object merge would otherwise discard an earlier row
// without showing the user what happened. arrayEach supplies the core utility's
// short-circuit behavior, so validation stops at the first actionable error.
const validateDrafts = (drafts: PreferenceDraft[]): string | null => {
    const variableNames = new Set<string>();
    const validationError = arrayEach(drafts, ({ index: variableIndex, value: draft }) => {
        const variableName = draft.name.trim();
        if (!variableName) return `Preference ${variableIndex + 1} needs a name.`;
        if (variableNames.has(variableName)) return `Preference name "${variableName}" is duplicated.`;
        variableNames.add(variableName);

        const versionNames = new Set<string>();
        const versionError = arrayEach(draft.versions, ({ index: versionIndex, value: version }) => {
            const versionName = version.key.trim();
            if (!versionName) return `Version ${versionIndex + 1} of "${variableName}" needs a key.`;
            if (versionNames.has(versionName)) return `Version key "${versionName}" is duplicated in "${variableName}".`;
            versionNames.add(versionName);
            return undefined;
        });
        return typeof versionError === 'string' ? versionError : undefined;
    });
    return typeof validationError === 'string' ? validationError : null;
};

// Pick a readable, non-conflicting key for the Add version action. Existing
// arbitrary keys are left untouched; the generated key is only a convenience.
const nextVersionKey = (versions: PreferenceVersionDraft[]): string => {
    const existing = new Set<string>();
    arrayEach(versions, ({ value: version }) => {
        existing.add(version.key);
    });
    let index = 1;
    while (existing.has(`v${index}`)) index += 1;
    return `v${index}`;
};

// The API keeps the canonical `current` key for compatibility; the compact UI
// presents it as the first version label v0 beside newly generated v1/v2 keys.
export const preferenceVersionLabel = (key: string): string => key === 'current' ? 'v0' : key;

export type PreferencesDialogProps = {
    /** Dashboard API URL; only its host and port are reused for preferences. */
    baseUrl: string;
    onClose: () => void;
};

export const PreferencesDialog: React.FC<PreferencesDialogProps> = ({ baseUrl, onClose }) => {
    const [profile, setProfile] = React.useState('');
    const [drafts, setDrafts] = React.useState<PreferenceDraft[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState('');
    const [selectedVersions, setSelectedVersions] = React.useState<string[]>([]);
    const requestIdRef = React.useRef(0);
    const activeMemoryKeyRef = React.useRef('');
    const draftsReadyRef = React.useRef(false);

    // Fetch the blank/default profile when the dialog opens. The blank field is
    // intentional: the endpoint interprets an omitted profile as default.json.
    const loadProfile = React.useCallback(async (selectedProfile: string) => {
        const requestId = ++requestIdRef.current;
        setLoading(true);
        setError('');
        setMessage('');
        try {
            const variables = await fetchPreferenceVariables(baseUrl, selectedProfile);
            if (requestId !== requestIdRef.current) return;
            const memoryKey = preferenceMemoryKey(selectedProfile);
            const cachedDrafts = preferenceDraftMemory.get(memoryKey);
            const loadedDrafts = cachedDrafts
                ? clonePreferenceDrafts(cachedDrafts)
                : preferenceVariablesToDrafts(variables);
            const loadedSelections = rememberedVersionKeys(
                loadedDrafts,
                preferenceVersionMemory.get(memoryKey)
            );
            activeMemoryKeyRef.current = memoryKey;
            draftsReadyRef.current = true;
            setDrafts(loadedDrafts);
            setSelectedVersions(loadedSelections);
        } catch (loadError) {
            if (requestId !== requestIdRef.current) return;
            setError(loadError instanceof Error ? loadError.message : String(loadError));
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    }, [baseUrl]);

    React.useEffect(() => {
        void loadProfile('');
    }, [loadProfile]);

    // Persist every local edit to the in-memory profile cache only. The API is
    // intentionally untouched here; only the explicit Save button
    // calls PUT.
    React.useEffect(() => {
        if (!draftsReadyRef.current || !activeMemoryKeyRef.current) return;
        preferenceDraftMemory.set(activeMemoryKeyRef.current, clonePreferenceDrafts(drafts));
    }, [drafts]);

    // The selected version is also browser-memory state, so changing a key and
    // reopening the compact dialog returns to the same version rather than
    // silently falling back to the first option.
    React.useEffect(() => {
        if (!draftsReadyRef.current || !activeMemoryKeyRef.current) return;
        preferenceVersionMemory.set(activeMemoryKeyRef.current, [...selectedVersions]);
    }, [selectedVersions]);

    // Keep row updates immutable so every edited textarea remains controlled by
    // the current draft and React never displays stale profile data.
    const updateVariable = React.useCallback((index: number, update: (draft: PreferenceDraft) => PreferenceDraft) => {
        setDrafts((current) => current.map((draft, draftIndex) => (draftIndex === index ? update(draft) : draft)));
    }, []);

    const addPreference = React.useCallback(() => {
        setDrafts((current) => [...current, { name: '', versions: [{ key: 'current', value: '' }] }]);
        setSelectedVersions((current) => [...current, 'current']);
        setMessage('');
        setError('');
    }, []);

    // Add a version with the next vN label and immediately select it so the
    // newly created value is visible without growing the card vertically.
    const addVersion = React.useCallback((variableIndex: number) => {
        const draft = drafts[variableIndex];
        if (!draft) return;
        const key = nextVersionKey(draft.versions);
        updateVariable(variableIndex, (current) => ({
            ...current,
            versions: [...current.versions, { key, value: '' }]
        }));
        setSelectedVersions((current) => {
            const next = [...current];
            next[variableIndex] = key;
            return next;
        });
    }, [drafts, updateVariable]);

    // Resolve the one visible version row for a preference. Existing custom
    // labels remain selectable, while stale selection state falls back safely
    // to the first stored version.
    const selectedVersionFor = React.useCallback((draft: PreferenceDraft, variableIndex: number) => {
        const selectedKey = selectedVersions[variableIndex] || draft.versions[0]?.key;
        const versionIndex = draft.versions.findIndex((version) => version.key === selectedKey);
        return {
            key: selectedKey ?? '',
            index: versionIndex >= 0 ? versionIndex : 0,
            version: draft.versions[versionIndex >= 0 ? versionIndex : 0]
        };
    }, [selectedVersions]);

    const updateSelectedVersionValue = React.useCallback(
        (variableIndex: number, update: (version: PreferenceVersionDraft) => PreferenceVersionDraft) => {
            const draft = drafts[variableIndex];
            if (!draft) return;
            const selected = selectedVersionFor(draft, variableIndex);
            updateVariable(variableIndex, (current) => ({
                ...current,
                versions: current.versions.map((version, versionIndex) =>
                    versionIndex === selected.index ? update(version) : version
                )
            }));
        },
        [drafts, selectedVersionFor, updateVariable]
    );

    const save = React.useCallback(async () => {
        const validationError = validateDrafts(drafts);
        if (validationError) {
            setError(validationError);
            setMessage('');
            return;
        }

        setSaving(true);
        setError('');
        setMessage('');
        try {
            const saved = await addPreferenceVariables(baseUrl, draftsToPreferenceVariables(drafts), profile);
            const savedDrafts = preferenceVariablesToDrafts(saved);
            const savedSelections = rememberedVersionKeys(savedDrafts, selectedVersions);
            const memoryKey = preferenceMemoryKey(profile);
            activeMemoryKeyRef.current = memoryKey;
            draftsReadyRef.current = true;
            preferenceDraftMemory.set(memoryKey, clonePreferenceDrafts(savedDrafts));
            preferenceVersionMemory.set(memoryKey, [...savedSelections]);
            setDrafts(savedDrafts);
            setSelectedVersions(savedSelections);
            setMessage('Preferences saved.');
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : String(saveError));
        } finally {
            setSaving(false);
        }
    }, [baseUrl, drafts, profile]);

    return (
        <PreferencesOverlay role="presentation" onClick={onClose}>
            <PreferencesPanel
                role="dialog"
                aria-modal="true"
                aria-labelledby="preferences-title"
                onClick={(event) => event.stopPropagation()}
            >
                <PreferencesHeader>
                    <div>
                        <PreferencesTitle id="preferences-title">Preferences</PreferencesTitle>
                    </div>
                    <CloseButton
                        type="button"
                        aria-label="Close preferences"
                        title="Close preferences"
                        onClick={onClose}
                    >
                        ×
                    </CloseButton>
                </PreferencesHeader>

                <ProfileBar>
                    <ProfileInput
                        id="preferences-profile"
                        aria-label="Preference profile"
                        value={profile}
                        placeholder="default"
                        onChange={(event) => setProfile(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') void loadProfile(profile);
                        }}
                    />
                    <Btn
                        onClick={() => void loadProfile(profile)}
                        disabled={loading || saving}
                        aria-label="Load preference profile"
                    >
                        {loading ? 'Loading…' : 'Load'}
                    </Btn>
                </ProfileBar>

                 <PreferencesScroll className="sg-scroll">
                    {drafts.map((draft, variableIndex) => {
                        const selected = selectedVersionFor(draft, variableIndex);
                        return (
                            <PreferenceCard key={`preference-${variableIndex}`}>
                                <PreferenceCardHeader>
                                    <PreferenceNameInput
                                        aria-label={`Preference name ${variableIndex + 1}`}
                                        value={draft.name}
                                        placeholder="Preference name"
                                        onChange={(event) =>
                                            updateVariable(variableIndex, (current) => ({
                                                ...current,
                                                name: event.target.value
                                            }))
                                        }
                                    />
                                    <AddVersionButton
                                        type="button"
                                        aria-label={`Add version to preference ${variableIndex + 1}`}
                                        title="Add version"
                                        onClick={() => addVersion(variableIndex)}
                                        disabled={loading || saving}
                                    >
                                        +
                                    </AddVersionButton>
                                </PreferenceCardHeader>

                                <VersionList>
                                    <VersionRow>
                                        <VersionRowHeader>
                                            <VersionKeySelect
                                                aria-label={`Version key ${variableIndex + 1}`}
                                                value={selected.key}
                                                onChange={(event) =>
                                                    setSelectedVersions((current) => {
                                                        const next = [...current];
                                                        next[variableIndex] = event.target.value;
                                                        return next;
                                                    })
                                                }
                                            >
                                                {draft.versions.map((version) => (
                                                    <option key={version.key} value={version.key}>
                                                        {preferenceVersionLabel(version.key)}
                                                    </option>
                                                ))}
                                            </VersionKeySelect>
                                        </VersionRowHeader>
                                        <PreferenceValueTextarea
                                            aria-label={`Preference value ${variableIndex + 1}`}
                                            rows={1}
                                            maxRows={6}
                                            value={selected.version?.value ?? ''}
                                            placeholder="Preference value"
                                            onChange={(event) =>
                                                updateSelectedVersionValue(variableIndex, (current) => ({
                                                    ...current,
                                                    value: event.target.value
                                                }))
                                            }
                                        />
                                    </VersionRow>
                                </VersionList>
                            </PreferenceCard>
                        );
                    })}
                    <AddPreferenceButton
                        type="button"
                        onClick={addPreference}
                        disabled={loading || saving}
                    >
                        Add New Preference
                    </AddPreferenceButton>
                </PreferencesScroll>

                {(error || message) && (
                    <DialogMessage role={error ? 'alert' : 'status'}>{error || message}</DialogMessage>
                )}

                <DialogActions>
                    <DialogActionGroup>
                        <Btn onClick={onClose}>Close</Btn>
                    </DialogActionGroup>
                    <DialogActionGroup>
                        <BtnPrimary
                            className="sg-primary"
                            onClick={() => void save()}
                            disabled={loading || saving}
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </BtnPrimary>
                    </DialogActionGroup>
                </DialogActions>
            </PreferencesPanel>
        </PreferencesOverlay>
    );
};
