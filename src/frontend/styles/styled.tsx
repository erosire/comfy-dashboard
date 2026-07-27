// Lightweight inline styled-component clone for the comfy-dashboard.
//
// Vendored from the story-generator pattern — a minimal factory that maps
// a tag + static style object into a React component. No runtime CSS-in-JS
// library needed. Supports standard HTML attributes + `as` prop override.

import React from 'react';

type StyleObject = React.CSSProperties & Record<`--${string}`, string | number>;

type StyledProps<Tag extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[Tag] & {
    as?: keyof JSX.IntrinsicElements;
    [key: string]: unknown;
};

// Create a styled element given a tag and a static style object.
export function styled<Tag extends keyof JSX.IntrinsicElements>(
    tag: Tag,
    style: StyleObject
): React.FC<StyledProps<Tag>> {
    const Component: React.FC<any> = ({ as, ...rest }) => {
        const Tag = (as || tag) as keyof JSX.IntrinsicElements;
        return React.createElement(Tag, { style, ...rest });
    };
    Component.displayName = `styled.${tag}`;
    return Component;
}
