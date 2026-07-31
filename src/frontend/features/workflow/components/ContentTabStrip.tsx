// ContentTabStrip — the PROMPT / JSON / OUTPUT tab switcher for the editor
// content area. The Copy and Clone buttons live in the workflow action bar
// at the bottom (Copy on the JSON tab only), immediately left of Save.
//
// Extracted verbatim from the original CloudTab.tsx content fragment.

import React from 'react';
import { theme } from '../../../styles';
import { TabBtn } from './ui';
import type { EditorContentTab } from './utils';

export type ContentTabStripProps = {
    activeTab: EditorContentTab;
    /** Number of fields promoted to the PROMPT tab (0 disables that tab). */
    promptFieldsCount: number;
    onSelectTab: (tab: EditorContentTab) => void;
};

export const ContentTabStrip: React.FC<ContentTabStripProps> = ({
    activeTab,
    promptFieldsCount,
    onSelectTab
}) => (
    <div
        style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 10,
            borderBottom: `1px solid ${theme.border}`
        }}
    >
        <div style={{ display: 'flex', gap: 4 }} role="tablist">
            <TabBtn
                className="sg-hover"
                role="tab"
                aria-selected={activeTab === 'prompt'}
                aria-disabled={promptFieldsCount === 0}
                data-testid="tab-prompt"
                onClick={() => {
                    // Nothing to show until at least one
                    // field is toggled on the JSON side.
                    if (promptFieldsCount > 0) onSelectTab('prompt');
                }}
                title={
                    promptFieldsCount === 0
                        ? 'Click a field label in the JSON tab to add it here'
                        : undefined
                }
                style={
                    promptFieldsCount === 0
                        ? { opacity: 0.4, cursor: 'not-allowed' }
                        : activeTab === 'prompt'
                          ? { color: theme.accent, borderBottomColor: theme.accent }
                          : undefined
                }
            >
                PROMPT
            </TabBtn>
            <TabBtn
                className="sg-hover"
                role="tab"
                aria-selected={activeTab === 'json'}
                data-testid="tab-json"
                onClick={() => onSelectTab('json')}
                style={
                    activeTab === 'json'
                        ? { color: theme.accent, borderBottomColor: theme.accent }
                        : undefined
                }
            >
                JSON
            </TabBtn>
            <TabBtn
                className="sg-hover"
                role="tab"
                aria-selected={activeTab === 'results'}
                data-testid="tab-results"
                onClick={() => onSelectTab('results')}
                style={
                    activeTab === 'results'
                        ? { color: theme.accent, borderBottomColor: theme.accent }
                        : undefined
                }
            >
                OUTPUT
            </TabBtn>
        </div>
    </div>
);
