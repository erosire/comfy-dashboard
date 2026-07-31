// GenerationsPane — the OUTPUT tab: the workflow's generations list.
// Clicking an item with results opens the full-screen result viewer.
//
// The editor area scrolls, so no height cap is needed here.
//
// Extracted verbatim from the original CloudTab.tsx OUTPUT tab body.

import React from 'react';
import styled from '@emotion/styled';
import { theme } from '../../../styles';
import type { GenerationSummary } from '../../../api';
import { formatRelativeTime } from './utils';
import { EmptyHint, SpinnerEl } from './ui';

const QueueItemEl = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 10px',
    borderRadius: theme.radiusMd,
    border: `1px solid ${theme.border}`,
    marginBottom: 4,
    backgroundColor: theme.surface2
});

const QueueItemHeader = styled('div')({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4
});

const QueueItemName = styled('div')({
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: '1 1 auto',
    minWidth: 0
});

const QueueItemMeta = styled('div')({
    fontSize: theme.fontSize.xs,
    color: theme.textFaint,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
});

const QueueStatusBadge = styled('span')({
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: theme.fontSize.xs,
    padding: '1px 6px',
    borderRadius: theme.radiusSm,
    fontWeight: 600,
    flex: '0 0 auto'
});

export type GenerationsPaneProps = {
    generations: GenerationSummary[];
    /** Opens the result viewer positioned at the generation's first result. */
    onOpenViewer: (generationId: string) => void;
};

export const GenerationsPane: React.FC<GenerationsPaneProps> = ({ generations, onOpenViewer }) => (
    <div data-testid="results-tab-pane">
        {generations.length === 0 && <EmptyHint>No generations yet.</EmptyHint>}
        {generations.map((gen) => {
            const hasResults = (gen.resultItems?.length ?? 0) > 0;
            const genStatusColor =
                gen.status === 'completed'
                    ? theme.success
                    : gen.status === 'failed'
                      ? theme.danger
                      : gen.status === 'processing'
                        ? theme.accent
                        : theme.textDim;
            const genStatusBg =
                gen.status === 'completed'
                    ? theme.successSoft
                    : gen.status === 'failed'
                      ? theme.dangerSoft
                      : gen.status === 'processing'
                        ? theme.accentSoft
                        : theme.surface2;
            return (
                <QueueItemEl
                    key={gen.id}
                    data-testid={`gen-item-${gen.id}`}
                    style={
                        hasResults
                            ? {
                                  cursor: 'pointer',
                                  transition: `border-color ${theme.transition}`
                              }
                            : undefined
                    }
                    onClick={hasResults ? () => onOpenViewer(gen.id) : undefined}
                >
                    <QueueItemHeader>
                        <QueueItemName title={gen.id}>{gen.id}</QueueItemName>
                        {hasResults && (
                            <span
                                style={{
                                    fontSize: theme.fontSize.xs,
                                    color: theme.accent,
                                    flexShrink: 0,
                                    marginLeft: 4
                                }}
                            >
                                {gen.resultCount} item{gen.resultCount !== 1 ? 's' : ''}
                            </span>
                        )}
                    </QueueItemHeader>
                    <QueueItemMeta>
                        <QueueStatusBadge
                            style={{
                                color: genStatusColor,
                                backgroundColor: genStatusBg
                            }}
                        >
                            {gen.status === 'processing' && <SpinnerEl />}
                            {gen.status}
                        </QueueStatusBadge>
                        {gen.generatedTime && (
                            <span style={{ color: theme.accent, fontWeight: 500 }}>
                                {gen.generatedTime}
                            </span>
                        )}
                        <span title={gen.createdDate}>
                            {formatRelativeTime(gen.createdDate)}
                        </span>
                    </QueueItemMeta>
                    {gen.error && (
                        <div
                            style={{
                                fontSize: theme.fontSize.xs,
                                color: theme.danger,
                                marginTop: 4,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap' as const
                            }}
                            title={gen.error}
                        >
                            {gen.error}
                        </div>
                    )}
                </QueueItemEl>
            );
        })}
    </div>
);
