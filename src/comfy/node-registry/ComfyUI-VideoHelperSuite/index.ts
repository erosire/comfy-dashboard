import type { NodeWidgetLayout } from '../types';
import { VHS_VideoCombine } from './VHS_VideoCombine';
import { VHS_LoadVideo } from './VHS_LoadVideo';
import { VHS_LoadVideoPath } from './VHS_LoadVideoPath';
import { VHS_LoadVideoFFmpeg } from './VHS_LoadVideoFFmpeg';
import { VHS_LoadVideoFFmpegPath } from './VHS_LoadVideoFFmpegPath';
import { VHS_LoadImagePath } from './VHS_LoadImagePath';
import { VHS_LoadImages } from './VHS_LoadImages';
import { VHS_LoadImagesPath } from './VHS_LoadImagesPath';
import { VHS_LoadAudio } from './VHS_LoadAudio';
import { VHS_LoadAudioUpload } from './VHS_LoadAudioUpload';
import { VHS_AudioToVHSAudio } from './VHS_AudioToVHSAudio';
import { VHS_VHSAudioToAudio } from './VHS_VHSAudioToAudio';
import { VHS_PruneOutputs } from './VHS_PruneOutputs';
import { VHS_BatchManager } from './VHS_BatchManager';
import { VHS_VideoInfo } from './VHS_VideoInfo';
import { VHS_VideoInfoSource } from './VHS_VideoInfoSource';
import { VHS_VideoInfoLoaded } from './VHS_VideoInfoLoaded';
import { VHS_SelectFilename } from './VHS_SelectFilename';
import { VHS_VAEEncodeBatched } from './VHS_VAEEncodeBatched';
import { VHS_VAEDecodeBatched } from './VHS_VAEDecodeBatched';
import { VHS_SplitLatents } from './VHS_SplitLatents';
import { VHS_SplitImages } from './VHS_SplitImages';
import { VHS_SplitMasks } from './VHS_SplitMasks';
import { VHS_MergeLatents } from './VHS_MergeLatents';
import { VHS_MergeImages } from './VHS_MergeImages';
import { VHS_MergeMasks } from './VHS_MergeMasks';
import { VHS_GetLatentCount } from './VHS_GetLatentCount';
import { VHS_GetImageCount } from './VHS_GetImageCount';
import { VHS_GetMaskCount } from './VHS_GetMaskCount';
import { VHS_DuplicateLatents } from './VHS_DuplicateLatents';
import { VHS_DuplicateImages } from './VHS_DuplicateImages';
import { VHS_DuplicateMasks } from './VHS_DuplicateMasks';
import { VHS_SelectEveryNthLatent } from './VHS_SelectEveryNthLatent';
import { VHS_SelectEveryNthImage } from './VHS_SelectEveryNthImage';
import { VHS_SelectEveryNthMask } from './VHS_SelectEveryNthMask';
import { VHS_SelectLatents } from './VHS_SelectLatents';
import { VHS_SelectImages } from './VHS_SelectImages';
import { VHS_SelectMasks } from './VHS_SelectMasks';
import { VHS_Unbatch } from './VHS_Unbatch';
import { VHS_SelectLatest } from './VHS_SelectLatest';

export const vhsNodes: Record<string, NodeWidgetLayout> = {
    VHS_VideoCombine,
    VHS_LoadVideo,
    VHS_LoadVideoPath,
    VHS_LoadVideoFFmpeg,
    VHS_LoadVideoFFmpegPath,
    VHS_LoadImagePath,
    VHS_LoadImages,
    VHS_LoadImagesPath,
    VHS_LoadAudio,
    VHS_LoadAudioUpload,
    VHS_AudioToVHSAudio,
    VHS_VHSAudioToAudio,
    VHS_PruneOutputs,
    VHS_BatchManager,
    VHS_VideoInfo,
    VHS_VideoInfoSource,
    VHS_VideoInfoLoaded,
    VHS_SelectFilename,
    VHS_VAEEncodeBatched,
    VHS_VAEDecodeBatched,
    VHS_SplitLatents,
    VHS_SplitImages,
    VHS_SplitMasks,
    VHS_MergeLatents,
    VHS_MergeImages,
    VHS_MergeMasks,
    VHS_GetLatentCount,
    VHS_GetImageCount,
    VHS_GetMaskCount,
    VHS_DuplicateLatents,
    VHS_DuplicateImages,
    VHS_DuplicateMasks,
    VHS_SelectEveryNthLatent,
    VHS_SelectEveryNthImage,
    VHS_SelectEveryNthMask,
    VHS_SelectLatents,
    VHS_SelectImages,
    VHS_SelectMasks,
    VHS_Unbatch,
    VHS_SelectLatest,
};

export {
    VHS_VideoCombine,
    VHS_LoadVideo,
    VHS_LoadVideoPath,
    VHS_LoadVideoFFmpeg,
    VHS_LoadVideoFFmpegPath,
    VHS_LoadImagePath,
    VHS_LoadImages,
    VHS_LoadImagesPath,
    VHS_LoadAudio,
    VHS_LoadAudioUpload,
    VHS_AudioToVHSAudio,
    VHS_VHSAudioToAudio,
    VHS_PruneOutputs,
    VHS_BatchManager,
    VHS_VideoInfo,
    VHS_VideoInfoSource,
    VHS_VideoInfoLoaded,
    VHS_SelectFilename,
    VHS_VAEEncodeBatched,
    VHS_VAEDecodeBatched,
    VHS_SplitLatents,
    VHS_SplitImages,
    VHS_SplitMasks,
    VHS_MergeLatents,
    VHS_MergeImages,
    VHS_MergeMasks,
    VHS_GetLatentCount,
    VHS_GetImageCount,
    VHS_GetMaskCount,
    VHS_DuplicateLatents,
    VHS_DuplicateImages,
    VHS_DuplicateMasks,
    VHS_SelectEveryNthLatent,
    VHS_SelectEveryNthImage,
    VHS_SelectEveryNthMask,
    VHS_SelectLatents,
    VHS_SelectImages,
    VHS_SelectMasks,
    VHS_Unbatch,
    VHS_SelectLatest,
};
