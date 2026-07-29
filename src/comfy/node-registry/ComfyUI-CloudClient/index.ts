import type { NodeWidgetLayout } from '../types';
import { ClientImageDownloadNode } from './ClientImageDownloadNode';
import { ClientVideoDownloadNode } from './ClientVideoDownloadNode';
import { RemoteImageLoader } from './RemoteImageLoader';
import { ServerMemoryImageNode } from './ServerMemoryImageNode';
import { TemporaryImagePreviewCloudClient } from './TemporaryImagePreviewCloudClient';
import { UniversalDataToImage } from './UniversalDataToImage';
import { UniversalDataToAudioVideo } from './UniversalDataToAudioVideo';

export const cloudClientNodes: Record<string, NodeWidgetLayout> = {
    ClientImageDownloadNode,
    ClientVideoDownloadNode,
    RemoteImageLoader,
    ServerMemoryImageNode,
    [TemporaryImagePreviewCloudClient.nodeType]: TemporaryImagePreviewCloudClient,
    UniversalDataToImage,
    UniversalDataToAudioVideo,
};

export {
    ClientImageDownloadNode,
    ClientVideoDownloadNode,
    RemoteImageLoader,
    ServerMemoryImageNode,
    TemporaryImagePreviewCloudClient,
    UniversalDataToImage,
    UniversalDataToAudioVideo,
};
