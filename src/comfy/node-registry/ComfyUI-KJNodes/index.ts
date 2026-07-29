import type { NodeWidgetLayout } from '../types';
import { BOOLConstant } from './BOOLConstant';
import { INTConstant } from './INTConstant';
import { FloatConstant } from './FloatConstant';
import { StringConstant } from './StringConstant';
import { StringConstantMultiline } from './StringConstantMultiline';
import { ConditioningMultiCombine } from './ConditioningMultiCombine';
import { ConditioningSetMaskAndCombine } from './ConditioningSetMaskAndCombine';
import { ConditioningSetMaskAndCombine3 } from './ConditioningSetMaskAndCombine3';
import { ConditioningSetMaskAndCombine4 } from './ConditioningSetMaskAndCombine4';
import { ConditioningSetMaskAndCombine5 } from './ConditioningSetMaskAndCombine5';
import { CondPassThrough } from './CondPassThrough';
import { WanImageToVideoSVIPro } from './WanImageToVideoSVIPro';
import { DrawMaskOnImage } from './DrawMaskOnImage';
import { DownloadAndLoadCLIPSeg } from './DownloadAndLoadCLIPSeg';
import { BatchCLIPSeg } from './BatchCLIPSeg';
import { BlockifyMask } from './BlockifyMask';
import { ColorToMask } from './ColorToMask';
import { CreateGradientMask } from './CreateGradientMask';
import { CreateTextMask } from './CreateTextMask';
import { CreateAudioMask } from './CreateAudioMask';
import { CreateFadeMask } from './CreateFadeMask';
import { CreateFadeMaskAdvanced } from './CreateFadeMaskAdvanced';
import { CreateFluidMask } from './CreateFluidMask';
import { CreateShapeMask } from './CreateShapeMask';
import { CreateVoronoiMask } from './CreateVoronoiMask';
import { CreateMagicMask } from './CreateMagicMask';
import { GetMaskSizeAndCount } from './GetMaskSizeAndCount';
import { GrowMaskWithBlur } from './GrowMaskWithBlur';
import { MaskBatchMulti } from './MaskBatchMulti';
import { OffsetMask } from './OffsetMask';
import { RemapMaskRange } from './RemapMaskRange';
import { ResizeMask } from './ResizeMask';
import { RoundMask } from './RoundMask';
import { SeparateMasks } from './SeparateMasks';
import { ConsolidateMasksKJ } from './ConsolidateMasksKJ';
import { AddLabel } from './AddLabel';
import { ColorMatch } from './ColorMatch';
import { ColorMatchV2 } from './ColorMatchV2';
import { ImageTensorList } from './ImageTensorList';
import { CrossFadeImages } from './CrossFadeImages';
import { CrossFadeImagesMulti } from './CrossFadeImagesMulti';
import { GetImagesFromBatchIndexed } from './GetImagesFromBatchIndexed';
import { GetImageRangeFromBatch } from './GetImageRangeFromBatch';
import { RandomImageFromBatch } from './RandomImageFromBatch';
import { GetLatentRangeFromBatch } from './GetLatentRangeFromBatch';
import { GetLatentSizeAndCount } from './GetLatentSizeAndCount';
import { GetImageSizeAndCount } from './GetImageSizeAndCount';
import { FastPreview } from './FastPreview';
import { FastPreviewBatch } from './FastPreviewBatch';
import { ImageBatchFilter } from './ImageBatchFilter';
import { ImageAndMaskPreview } from './ImageAndMaskPreview';
import { ImageAddMulti } from './ImageAddMulti';
import { ImageBatchJoinWithTransition } from './ImageBatchJoinWithTransition';
import { ImageBatchMulti } from './ImageBatchMulti';
import { ImageBatchRepeatInterleaving } from './ImageBatchRepeatInterleaving';
import { ImageBatchTestPattern } from './ImageBatchTestPattern';
import { ImageConcanate } from './ImageConcanate';
import { ImageConcatFromBatch } from './ImageConcatFromBatch';
import { ImageConcatMulti } from './ImageConcatMulti';
import { ImageCropByMask } from './ImageCropByMask';
import { ImageCropByMaskAndResize } from './ImageCropByMaskAndResize';
import { ImageCropByMaskBatch } from './ImageCropByMaskBatch';
import { ImageUncropByMask } from './ImageUncropByMask';
import { ImageBatchExtendWithOverlap } from './ImageBatchExtendWithOverlap';
import { ImageGrabPIL } from './ImageGrabPIL';
import { ImageGridComposite2x2 } from './ImageGridComposite2x2';
import { ImageGridComposite3x3 } from './ImageGridComposite3x3';
import { ImageGridtoBatch } from './ImageGridtoBatch';
import { ImageNoiseAugmentation } from './ImageNoiseAugmentation';
import { ImageNormalize_Neg1_To_1 } from './ImageNormalize_Neg1_To_1';
import { ImagePass } from './ImagePass';
import { ImagePadKJ } from './ImagePadKJ';
import { ImagePadForOutpaintMasked } from './ImagePadForOutpaintMasked';
import { ImagePadForOutpaintTargetSize } from './ImagePadForOutpaintTargetSize';
import { ImagePrepForICLora } from './ImagePrepForICLora';
import { ImageResizeKJ } from './ImageResizeKJ';
import { ImageUpscaleWithModelBatched } from './ImageUpscaleWithModelBatched';
import { InsertImagesToBatchIndexed } from './InsertImagesToBatchIndexed';
import { InsertLatentToIndexed } from './InsertLatentToIndexed';
import { LoadAndResizeImage } from './LoadAndResizeImage';
import { LoadImagesFromFolderKJ } from './LoadImagesFromFolderKJ';
import { LoadVideosFromFolder } from './LoadVideosFromFolder';
import { MergeImageChannels } from './MergeImageChannels';
import { PadImageBatchInterleaved } from './PadImageBatchInterleaved';
import { PreviewAnimation } from './PreviewAnimation';
import { RemapImageRange } from './RemapImageRange';
import { ReverseImageBatch } from './ReverseImageBatch';
import { ReplaceImagesInBatch } from './ReplaceImagesInBatch';
import { SaveImageWithAlpha } from './SaveImageWithAlpha';
import { SaveImageKJ } from './SaveImageKJ';
import { ShuffleImageBatch } from './ShuffleImageBatch';
import { SplitImageChannels } from './SplitImageChannels';
import { TransitionImagesMulti } from './TransitionImagesMulti';
import { TransitionImagesInBatch } from './TransitionImagesInBatch';
import { EncodeVideoComponents } from './EncodeVideoComponents';
import { DecodeAndSaveVideo } from './DecodeAndSaveVideo';
import { ImageTransformKJ } from './ImageTransformKJ';
import { BBOXToBoundingBoxKJ } from './BBOXToBoundingBoxKJ';
import { Ideogram4PromptBuilderKJ } from './Ideogram4PromptBuilderKJ';
import { HDRPreviewKJ } from './HDRPreviewKJ';
import { ModelPreviewOverrideKJ } from './ModelPreviewOverrideKJ';
import { GetPreviewOverrideFramesKJ } from './GetPreviewOverrideFramesKJ';
import { PreviewImageOrMask } from './PreviewImageOrMask';
import { ImageSharpenKJ } from './ImageSharpenKJ';
import { BatchCropFromMask } from './BatchCropFromMask';
import { BatchCropFromMaskAdvanced } from './BatchCropFromMaskAdvanced';
import { FilterZeroMasksAndCorrespondingImages } from './FilterZeroMasksAndCorrespondingImages';
import { InsertImageBatchByIndexes } from './InsertImageBatchByIndexes';
import { BatchUncrop } from './BatchUncrop';
import { BatchUncropAdvanced } from './BatchUncropAdvanced';
import { SplitBboxes } from './SplitBboxes';
import { BboxToInt } from './BboxToInt';
import { BboxVisualize } from './BboxVisualize';
import { GenerateNoise } from './GenerateNoise';
import { FlipSigmasAdjusted } from './FlipSigmasAdjusted';
import { InjectNoiseToLatent } from './InjectNoiseToLatent';
import { CustomSigmas } from './CustomSigmas';
import { StringToFloatList } from './StringToFloatList';
import { WidgetToString } from './WidgetToString';
import { SaveStringKJ } from './SaveStringKJ';
import { DummyOut } from './DummyOut';
import { GetLatentsFromBatchIndexed } from './GetLatentsFromBatchIndexed';
import { ScaleBatchPromptSchedule } from './ScaleBatchPromptSchedule';
import { CameraPoseVisualizer } from './CameraPoseVisualizer';
import { AppendStringsToList } from './AppendStringsToList';
import { JoinStrings } from './JoinStrings';
import { JoinStringMulti } from './JoinStringMulti';
import { SimpleCalculatorKJ } from './SimpleCalculatorKJ';
import { SomethingToString } from './SomethingToString';
import { Sleep } from './Sleep';
import { VRAM_Debug } from './VRAM_Debug';
import { EmptyLatentImagePresets } from './EmptyLatentImagePresets';
import { EmptyLatentImageCustomPresets } from './EmptyLatentImageCustomPresets';
import { ModelPassThrough } from './ModelPassThrough';
import { ModelSaveKJ } from './ModelSaveKJ';
import { SetShakkerLabsUnionControlNetType } from './SetShakkerLabsUnionControlNetType';
import { StyleModelApplyAdvanced } from './StyleModelApplyAdvanced';
import { DiffusionModelSelector } from './DiffusionModelSelector';
import { LazySwitchKJ } from './LazySwitchKJ';
import { VisualizeSigmasKJ } from './VisualizeSigmasKJ';
import { NormalizedAmplitudeToMask } from './NormalizedAmplitudeToMask';
import { NormalizedAmplitudeToFloatList } from './NormalizedAmplitudeToFloatList';
import { OffsetMaskByNormalizedAmplitude } from './OffsetMaskByNormalizedAmplitude';
import { ImageTransformByNormalizedAmplitude } from './ImageTransformByNormalizedAmplitude';
import { AudioConcatenate } from './AudioConcatenate';
import { SplineEditor } from './SplineEditor';
import { CreateShapeImageOnPath } from './CreateShapeImageOnPath';
import { CreateShapeMaskOnPath } from './CreateShapeMaskOnPath';
import { CreateTextOnPath } from './CreateTextOnPath';
import { CreateGradientFromCoords } from './CreateGradientFromCoords';
import { CutAndDragOnPath } from './CutAndDragOnPath';
import { GradientToFloat } from './GradientToFloat';
import { WeightScheduleExtend } from './WeightScheduleExtend';
import { MaskOrImageToWeight } from './MaskOrImageToWeight';
import { WeightScheduleConvert } from './WeightScheduleConvert';
import { FloatToMask } from './FloatToMask';
import { FloatToSigmas } from './FloatToSigmas';
import { SigmasToFloat } from './SigmasToFloat';
import { PlotCoordinates } from './PlotCoordinates';
import { InterpolateCoords } from './InterpolateCoords';
import { PointsEditor } from './PointsEditor';
import { SoundReactive } from './SoundReactive';
import { StableZero123_BatchSchedule } from './StableZero123_BatchSchedule';
import { SV3D_BatchSchedule } from './SV3D_BatchSchedule';
import { Superprompt } from './Superprompt';
import { GLIGENTextBoxApplyBatchCoords } from './GLIGENTextBoxApplyBatchCoords';
import { CheckpointPerturbWeights } from './CheckpointPerturbWeights';
import { Screencap_mss } from './Screencap_mss';
import { ScreencapStream } from './ScreencapStream';
import { WebcamCaptureCV2 } from './WebcamCaptureCV2';
import { DifferentialDiffusionAdvanced } from './DifferentialDiffusionAdvanced';
import { DiTBlockLoraLoader } from './DiTBlockLoraLoader';
import { FluxBlockLoraSelect } from './FluxBlockLoraSelect';
import { HunyuanVideoBlockLoraSelect } from './HunyuanVideoBlockLoraSelect';
import { Wan21BlockLoraSelect } from './Wan21BlockLoraSelect';
import { LTX2BlockLoraSelect } from './LTX2BlockLoraSelect';
import { CustomControlNetWeightsFluxFromList } from './CustomControlNetWeightsFluxFromList';
import { CheckpointLoaderKJ } from './CheckpointLoaderKJ';
import { DiffusionModelLoaderKJ } from './DiffusionModelLoaderKJ';
import { TorchCompileModelFluxAdvancedV2 } from './TorchCompileModelFluxAdvancedV2';
import { TorchCompileVAE } from './TorchCompileVAE';
import { TorchCompileControlNet } from './TorchCompileControlNet';
import { TorchCompileModelWanVideoV2 } from './TorchCompileModelWanVideoV2';
import { PathchSageAttentionKJ } from './PathchSageAttentionKJ';
import { PatchFlashAttentionKJ } from './PatchFlashAttentionKJ';
import { LeapfusionHunyuanI2VPatcher } from './LeapfusionHunyuanI2VPatcher';
import { VAELoaderKJ } from './VAELoaderKJ';
import { VAEMergeKJ } from './VAEMergeKJ';
import { VAEDecodeLoopKJ } from './VAEDecodeLoopKJ';
import { ScheduledCFGGuidance } from './ScheduledCFGGuidance';
import { ApplyRifleXRoPE_HunuyanVideo } from './ApplyRifleXRoPE_HunuyanVideo';
import { ApplyRifleXRoPE_WanVideo } from './ApplyRifleXRoPE_WanVideo';
import { WanVideoTeaCacheKJ } from './WanVideoTeaCacheKJ';
import { WanVideoEnhanceAVideoKJ } from './WanVideoEnhanceAVideoKJ';
import { SkipLayerGuidanceWanVideo } from './SkipLayerGuidanceWanVideo';
import { TimerNodeKJ } from './TimerNodeKJ';
import { HunyuanVideoEncodeKeyframesToCond } from './HunyuanVideoEncodeKeyframesToCond';
import { CFGZeroStarAndInit } from './CFGZeroStarAndInit';
import { PiDColorBiasCorrection } from './PiDColorBiasCorrection';
import { ModelPatchTorchSettings } from './ModelPatchTorchSettings';
import { WanVideoNAG } from './WanVideoNAG';
import { Krea2PromptWeight } from './Krea2PromptWeight';
import { GGUFLoaderKJ } from './GGUFLoaderKJ';
import { LatentInpaintTTM } from './LatentInpaintTTM';
import { NABLA_AttentionKJ } from './NABLA_AttentionKJ';
import { TorchCompileModelAdvanced } from './TorchCompileModelAdvanced';
import { StartRecordCUDAMemoryHistory } from './StartRecordCUDAMemoryHistory';
import { EndRecordCUDAMemoryHistory } from './EndRecordCUDAMemoryHistory';
import { VisualizeCUDAMemoryHistory } from './VisualizeCUDAMemoryHistory';
import { PreviewLatentNoiseMask } from './PreviewLatentNoiseMask';
import { ModelMemoryUseReportPatch } from './ModelMemoryUseReportPatch';
import { ModelMemoryUsageFactorOverride } from './ModelMemoryUsageFactorOverride';
import { WanChunkFeedForward } from './WanChunkFeedForward';
import { Ideogram4OptimizationsKJ } from './Ideogram4OptimizationsKJ';
import { SamplerSelfRefineVideo } from './SamplerSelfRefineVideo';
import { PlaySoundKJ } from './PlaySoundKJ';
import { LoraExtractKJ } from './LoraExtractKJ';
import { LoraReduceRankKJ } from './LoraReduceRankKJ';
import { GetTrackRange } from './GetTrackRange';
import { AddNoiseToTrackPath } from './AddNoiseToTrackPath';
import { ContextWindowsVisualizerKJ } from './ContextWindowsVisualizerKJ';
import { LTXVEnhanceAVideoKJ } from './LTXVEnhanceAVideoKJ';
import { LTXVAddGuideMulti } from './LTXVAddGuideMulti';
import { LTXVAddGuidesFromBatch } from './LTXVAddGuidesFromBatch';
import { LTXVAudioVideoMask } from './LTXVAudioVideoMask';
import { LTX2_NAG } from './LTX2_NAG';
import { LTXVChunkFeedForward } from './LTXVChunkFeedForward';
import { LTX2SamplingPreviewOverride } from './LTX2SamplingPreviewOverride';
import { LTX2AudioLatentNormalizingSampling } from './LTX2AudioLatentNormalizingSampling';
import { LTXVImgToVideoInplaceKJ } from './LTXVImgToVideoInplaceKJ';
import { LTX2AttentionTunerPatch } from './LTX2AttentionTunerPatch';
import { LTX2MemoryEfficientSageAttentionPatch } from './LTX2MemoryEfficientSageAttentionPatch';
import { LTX2LoraLoaderAdvanced } from './LTX2LoraLoaderAdvanced';
import { WanVideoMemoryEfficientSageAttentionPatch } from './WanVideoMemoryEfficientSageAttentionPatch';
import { ImageResizeKJv2 } from './ImageResizeKJv2';

export const ComfyUIKJNodes: Record<string, NodeWidgetLayout> = {
    ImageResizeKJv2,
    BOOLConstant,
    INTConstant,
    FloatConstant,
    StringConstant,
    StringConstantMultiline,
    ConditioningMultiCombine,
    ConditioningSetMaskAndCombine,
    ConditioningSetMaskAndCombine3,
    ConditioningSetMaskAndCombine4,
    ConditioningSetMaskAndCombine5,
    CondPassThrough,
    WanImageToVideoSVIPro,
    DrawMaskOnImage,
    DownloadAndLoadCLIPSeg,
    BatchCLIPSeg,
    BlockifyMask,
    ColorToMask,
    CreateGradientMask,
    CreateTextMask,
    CreateAudioMask,
    CreateFadeMask,
    CreateFadeMaskAdvanced,
    CreateFluidMask,
    CreateShapeMask,
    CreateVoronoiMask,
    CreateMagicMask,
    GetMaskSizeAndCount,
    GrowMaskWithBlur,
    MaskBatchMulti,
    OffsetMask,
    RemapMaskRange,
    ResizeMask,
    RoundMask,
    SeparateMasks,
    ConsolidateMasksKJ,
    AddLabel,
    ColorMatch,
    ColorMatchV2,
    ImageTensorList,
    CrossFadeImages,
    CrossFadeImagesMulti,
    GetImagesFromBatchIndexed,
    GetImageRangeFromBatch,
    RandomImageFromBatch,
    GetLatentRangeFromBatch,
    GetLatentSizeAndCount,
    GetImageSizeAndCount,
    FastPreview,
    FastPreviewBatch,
    ImageBatchFilter,
    ImageAndMaskPreview,
    ImageAddMulti,
    ImageBatchJoinWithTransition,
    ImageBatchMulti,
    ImageBatchRepeatInterleaving,
    ImageBatchTestPattern,
    ImageConcanate,
    ImageConcatFromBatch,
    ImageConcatMulti,
    ImageCropByMask,
    ImageCropByMaskAndResize,
    ImageCropByMaskBatch,
    ImageUncropByMask,
    ImageBatchExtendWithOverlap,
    ImageGrabPIL,
    ImageGridComposite2x2,
    ImageGridComposite3x3,
    ImageGridtoBatch,
    ImageNoiseAugmentation,
    ImageNormalize_Neg1_To_1,
    ImagePass,
    ImagePadKJ,
    ImagePadForOutpaintMasked,
    ImagePadForOutpaintTargetSize,
    ImagePrepForICLora,
    ImageResizeKJ,
    ImageUpscaleWithModelBatched,
    InsertImagesToBatchIndexed,
    InsertLatentToIndexed,
    LoadAndResizeImage,
    LoadImagesFromFolderKJ,
    LoadVideosFromFolder,
    MergeImageChannels,
    PadImageBatchInterleaved,
    PreviewAnimation,
    RemapImageRange,
    ReverseImageBatch,
    ReplaceImagesInBatch,
    SaveImageWithAlpha,
    SaveImageKJ,
    ShuffleImageBatch,
    SplitImageChannels,
    TransitionImagesMulti,
    TransitionImagesInBatch,
    EncodeVideoComponents,
    DecodeAndSaveVideo,
    ImageTransformKJ,
    BBOXToBoundingBoxKJ,
    Ideogram4PromptBuilderKJ,
    HDRPreviewKJ,
    ModelPreviewOverrideKJ,
    GetPreviewOverrideFramesKJ,
    PreviewImageOrMask,
    ImageSharpenKJ,
    BatchCropFromMask,
    BatchCropFromMaskAdvanced,
    FilterZeroMasksAndCorrespondingImages,
    InsertImageBatchByIndexes,
    BatchUncrop,
    BatchUncropAdvanced,
    SplitBboxes,
    BboxToInt,
    BboxVisualize,
    GenerateNoise,
    FlipSigmasAdjusted,
    InjectNoiseToLatent,
    CustomSigmas,
    StringToFloatList,
    WidgetToString,
    SaveStringKJ,
    DummyOut,
    GetLatentsFromBatchIndexed,
    ScaleBatchPromptSchedule,
    CameraPoseVisualizer,
    AppendStringsToList,
    JoinStrings,
    JoinStringMulti,
    SimpleCalculatorKJ,
    SomethingToString,
    Sleep,
    VRAM_Debug,
    EmptyLatentImagePresets,
    EmptyLatentImageCustomPresets,
    ModelPassThrough,
    ModelSaveKJ,
    SetShakkerLabsUnionControlNetType,
    StyleModelApplyAdvanced,
    DiffusionModelSelector,
    LazySwitchKJ,
    VisualizeSigmasKJ,
    NormalizedAmplitudeToMask,
    NormalizedAmplitudeToFloatList,
    OffsetMaskByNormalizedAmplitude,
    ImageTransformByNormalizedAmplitude,
    AudioConcatenate,
    SplineEditor,
    CreateShapeImageOnPath,
    CreateShapeMaskOnPath,
    CreateTextOnPath,
    CreateGradientFromCoords,
    CutAndDragOnPath,
    GradientToFloat,
    WeightScheduleExtend,
    MaskOrImageToWeight,
    WeightScheduleConvert,
    FloatToMask,
    FloatToSigmas,
    SigmasToFloat,
    PlotCoordinates,
    InterpolateCoords,
    PointsEditor,
    SoundReactive,
    StableZero123_BatchSchedule,
    SV3D_BatchSchedule,
    Superprompt,
    GLIGENTextBoxApplyBatchCoords,
    CheckpointPerturbWeights,
    Screencap_mss,
    ScreencapStream,
    WebcamCaptureCV2,
    DifferentialDiffusionAdvanced,
    DiTBlockLoraLoader,
    FluxBlockLoraSelect,
    HunyuanVideoBlockLoraSelect,
    Wan21BlockLoraSelect,
    LTX2BlockLoraSelect,
    CustomControlNetWeightsFluxFromList,
    CheckpointLoaderKJ,
    DiffusionModelLoaderKJ,
    TorchCompileModelFluxAdvancedV2,
    TorchCompileVAE,
    TorchCompileControlNet,
    TorchCompileModelWanVideoV2,
    PathchSageAttentionKJ,
    PatchFlashAttentionKJ,
    LeapfusionHunyuanI2VPatcher,
    VAELoaderKJ,
    VAEMergeKJ,
    VAEDecodeLoopKJ,
    ScheduledCFGGuidance,
    ApplyRifleXRoPE_HunuyanVideo,
    ApplyRifleXRoPE_WanVideo,
    WanVideoTeaCacheKJ,
    WanVideoEnhanceAVideoKJ,
    SkipLayerGuidanceWanVideo,
    TimerNodeKJ,
    HunyuanVideoEncodeKeyframesToCond,
    CFGZeroStarAndInit,
    PiDColorBiasCorrection,
    ModelPatchTorchSettings,
    WanVideoNAG,
    Krea2PromptWeight,
    GGUFLoaderKJ,
    LatentInpaintTTM,
    NABLA_AttentionKJ,
    TorchCompileModelAdvanced,
    StartRecordCUDAMemoryHistory,
    EndRecordCUDAMemoryHistory,
    VisualizeCUDAMemoryHistory,
    PreviewLatentNoiseMask,
    ModelMemoryUseReportPatch,
    ModelMemoryUsageFactorOverride,
    WanChunkFeedForward,
    Ideogram4OptimizationsKJ,
    SamplerSelfRefineVideo,
    PlaySoundKJ,
    LoraExtractKJ,
    LoraReduceRankKJ,
    GetTrackRange,
    AddNoiseToTrackPath,
    ContextWindowsVisualizerKJ,
    LTXVEnhanceAVideoKJ,
    LTXVAddGuideMulti,
    LTXVAddGuidesFromBatch,
    LTXVAudioVideoMask,
    LTX2_NAG,
    LTXVChunkFeedForward,
    LTX2SamplingPreviewOverride,
    LTX2AudioLatentNormalizingSampling,
    LTXVImgToVideoInplaceKJ,
    LTX2AttentionTunerPatch,
    LTX2MemoryEfficientSageAttentionPatch,
    LTX2LoraLoaderAdvanced,
    WanVideoMemoryEfficientSageAttentionPatch,
};

export {
    ImageResizeKJv2,
    BOOLConstant,
    INTConstant,
    FloatConstant,
    StringConstant,
    StringConstantMultiline,
    ConditioningMultiCombine,
    ConditioningSetMaskAndCombine,
    ConditioningSetMaskAndCombine3,
    ConditioningSetMaskAndCombine4,
    ConditioningSetMaskAndCombine5,
    CondPassThrough,
    WanImageToVideoSVIPro,
    DrawMaskOnImage,
    DownloadAndLoadCLIPSeg,
    BatchCLIPSeg,
    BlockifyMask,
    ColorToMask,
    CreateGradientMask,
    CreateTextMask,
    CreateAudioMask,
    CreateFadeMask,
    CreateFadeMaskAdvanced,
    CreateFluidMask,
    CreateShapeMask,
    CreateVoronoiMask,
    CreateMagicMask,
    GetMaskSizeAndCount,
    GrowMaskWithBlur,
    MaskBatchMulti,
    OffsetMask,
    RemapMaskRange,
    ResizeMask,
    RoundMask,
    SeparateMasks,
    ConsolidateMasksKJ,
    AddLabel,
    ColorMatch,
    ColorMatchV2,
    ImageTensorList,
    CrossFadeImages,
    CrossFadeImagesMulti,
    GetImagesFromBatchIndexed,
    GetImageRangeFromBatch,
    RandomImageFromBatch,
    GetLatentRangeFromBatch,
    GetLatentSizeAndCount,
    GetImageSizeAndCount,
    FastPreview,
    FastPreviewBatch,
    ImageBatchFilter,
    ImageAndMaskPreview,
    ImageAddMulti,
    ImageBatchJoinWithTransition,
    ImageBatchMulti,
    ImageBatchRepeatInterleaving,
    ImageBatchTestPattern,
    ImageConcanate,
    ImageConcatFromBatch,
    ImageConcatMulti,
    ImageCropByMask,
    ImageCropByMaskAndResize,
    ImageCropByMaskBatch,
    ImageUncropByMask,
    ImageBatchExtendWithOverlap,
    ImageGrabPIL,
    ImageGridComposite2x2,
    ImageGridComposite3x3,
    ImageGridtoBatch,
    ImageNoiseAugmentation,
    ImageNormalize_Neg1_To_1,
    ImagePass,
    ImagePadKJ,
    ImagePadForOutpaintMasked,
    ImagePadForOutpaintTargetSize,
    ImagePrepForICLora,
    ImageResizeKJ,
    ImageUpscaleWithModelBatched,
    InsertImagesToBatchIndexed,
    InsertLatentToIndexed,
    LoadAndResizeImage,
    LoadImagesFromFolderKJ,
    LoadVideosFromFolder,
    MergeImageChannels,
    PadImageBatchInterleaved,
    PreviewAnimation,
    RemapImageRange,
    ReverseImageBatch,
    ReplaceImagesInBatch,
    SaveImageWithAlpha,
    SaveImageKJ,
    ShuffleImageBatch,
    SplitImageChannels,
    TransitionImagesMulti,
    TransitionImagesInBatch,
    EncodeVideoComponents,
    DecodeAndSaveVideo,
    ImageTransformKJ,
    BBOXToBoundingBoxKJ,
    Ideogram4PromptBuilderKJ,
    HDRPreviewKJ,
    ModelPreviewOverrideKJ,
    GetPreviewOverrideFramesKJ,
    PreviewImageOrMask,
    ImageSharpenKJ,
    BatchCropFromMask,
    BatchCropFromMaskAdvanced,
    FilterZeroMasksAndCorrespondingImages,
    InsertImageBatchByIndexes,
    BatchUncrop,
    BatchUncropAdvanced,
    SplitBboxes,
    BboxToInt,
    BboxVisualize,
    GenerateNoise,
    FlipSigmasAdjusted,
    InjectNoiseToLatent,
    CustomSigmas,
    StringToFloatList,
    WidgetToString,
    SaveStringKJ,
    DummyOut,
    GetLatentsFromBatchIndexed,
    ScaleBatchPromptSchedule,
    CameraPoseVisualizer,
    AppendStringsToList,
    JoinStrings,
    JoinStringMulti,
    SimpleCalculatorKJ,
    SomethingToString,
    Sleep,
    VRAM_Debug,
    EmptyLatentImagePresets,
    EmptyLatentImageCustomPresets,
    ModelPassThrough,
    ModelSaveKJ,
    SetShakkerLabsUnionControlNetType,
    StyleModelApplyAdvanced,
    DiffusionModelSelector,
    LazySwitchKJ,
    VisualizeSigmasKJ,
    NormalizedAmplitudeToMask,
    NormalizedAmplitudeToFloatList,
    OffsetMaskByNormalizedAmplitude,
    ImageTransformByNormalizedAmplitude,
    AudioConcatenate,
    SplineEditor,
    CreateShapeImageOnPath,
    CreateShapeMaskOnPath,
    CreateTextOnPath,
    CreateGradientFromCoords,
    CutAndDragOnPath,
    GradientToFloat,
    WeightScheduleExtend,
    MaskOrImageToWeight,
    WeightScheduleConvert,
    FloatToMask,
    FloatToSigmas,
    SigmasToFloat,
    PlotCoordinates,
    InterpolateCoords,
    PointsEditor,
    SoundReactive,
    StableZero123_BatchSchedule,
    SV3D_BatchSchedule,
    Superprompt,
    GLIGENTextBoxApplyBatchCoords,
    CheckpointPerturbWeights,
    Screencap_mss,
    ScreencapStream,
    WebcamCaptureCV2,
    DifferentialDiffusionAdvanced,
    DiTBlockLoraLoader,
    FluxBlockLoraSelect,
    HunyuanVideoBlockLoraSelect,
    Wan21BlockLoraSelect,
    LTX2BlockLoraSelect,
    CustomControlNetWeightsFluxFromList,
    CheckpointLoaderKJ,
    DiffusionModelLoaderKJ,
    TorchCompileModelFluxAdvancedV2,
    TorchCompileVAE,
    TorchCompileControlNet,
    TorchCompileModelWanVideoV2,
    PathchSageAttentionKJ,
    PatchFlashAttentionKJ,
    LeapfusionHunyuanI2VPatcher,
    VAELoaderKJ,
    VAEMergeKJ,
    VAEDecodeLoopKJ,
    ScheduledCFGGuidance,
    ApplyRifleXRoPE_HunuyanVideo,
    ApplyRifleXRoPE_WanVideo,
    WanVideoTeaCacheKJ,
    WanVideoEnhanceAVideoKJ,
    SkipLayerGuidanceWanVideo,
    TimerNodeKJ,
    HunyuanVideoEncodeKeyframesToCond,
    CFGZeroStarAndInit,
    PiDColorBiasCorrection,
    ModelPatchTorchSettings,
    WanVideoNAG,
    Krea2PromptWeight,
    GGUFLoaderKJ,
    LatentInpaintTTM,
    NABLA_AttentionKJ,
    TorchCompileModelAdvanced,
    StartRecordCUDAMemoryHistory,
    EndRecordCUDAMemoryHistory,
    VisualizeCUDAMemoryHistory,
    PreviewLatentNoiseMask,
    ModelMemoryUseReportPatch,
    ModelMemoryUsageFactorOverride,
    WanChunkFeedForward,
    Ideogram4OptimizationsKJ,
    SamplerSelfRefineVideo,
    PlaySoundKJ,
    LoraExtractKJ,
    LoraReduceRankKJ,
    GetTrackRange,
    AddNoiseToTrackPath,
    ContextWindowsVisualizerKJ,
    LTXVEnhanceAVideoKJ,
    LTXVAddGuideMulti,
    LTXVAddGuidesFromBatch,
    LTXVAudioVideoMask,
    LTX2_NAG,
    LTXVChunkFeedForward,
    LTX2SamplingPreviewOverride,
    LTX2AudioLatentNormalizingSampling,
    LTXVImgToVideoInplaceKJ,
    LTX2AttentionTunerPatch,
    LTX2MemoryEfficientSageAttentionPatch,
    LTX2LoraLoaderAdvanced,
    WanVideoMemoryEfficientSageAttentionPatch,
};
