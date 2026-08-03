import type { NodeWidgetLayout } from './types';

// VAEDecodeAudio receives both samples and VAE through links, leaving no
// serialized widget values to map; registering it still gives the node a
// display name and prevents the dashboard from marking it as unknown.
export const VAEDecodeAudio: NodeWidgetLayout = {
    nodeType: 'VAEDecodeAudio',
    displayName: 'VAE Decode Audio',
    category: 'model/latent',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_audio.py',
        extension: 'ComfyUI',
    },
    widgets: [],
};
