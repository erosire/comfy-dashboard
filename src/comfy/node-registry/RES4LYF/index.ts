import type { NodeWidgetLayout } from '../types';

import { ClownsharKSampler_Beta } from './ClownsharKSampler_Beta';
import { FluxLoader } from './FluxLoader';
import { SD35Loader } from './SD35Loader';
import { RES4LYFModelLoader } from './RES4LYFModelLoader';
import { LayerPatcher } from './LayerPatcher';
import { TextBox1 } from './TextBox1';
import { TextBox2 } from './TextBox2';
import { TextBox3 } from './TextBox3';
import { TextConcatenate } from './TextConcatenate';
import { TextBoxConcatenate } from './TextBoxConcatenate';
import { TextLoadFile } from './TextLoadFile';
import { TextShuffle } from './TextShuffle';
import { TextShuffleAndTruncate } from './TextShuffleAndTruncate';
import { TextTruncateTokens } from './TextTruncateTokens';
import { SeedGenerator } from './SeedGenerator';
import { ClownRegionalConditioning } from './ClownRegionalConditioning';
import { ClownRegionalConditionings } from './ClownRegionalConditionings';
import { ClownRegionalConditioning2 } from './ClownRegionalConditioning2';
import { ClownRegionalConditioning3 } from './ClownRegionalConditioning3';
import { ClownRegionalConditioning_AB } from './ClownRegionalConditioning_AB';
import { ClownRegionalConditioning_ABC } from './ClownRegionalConditioning_ABC';
import { CLIPTextEncodeFluxUnguided } from './CLIPTextEncodeFluxUnguided';
import { ConditioningOrthoCollin } from './ConditioningOrthoCollin';
import { ConditioningAverageScheduler } from './ConditioningAverageScheduler';
import { ConditioningMultiply } from './ConditioningMultiply';
import { ConditioningAdd } from './ConditioningAdd';
import { Conditioning_Recast64 } from './Conditioning_Recast64';
import { StableCascade_StageB_Conditioning64 } from './StableCascade_StageB_Conditioning64';
import { ConditioningZeroAndTruncate } from './ConditioningZeroAndTruncate';
import { ConditioningTruncate } from './ConditioningTruncate';
import { StyleModelApplyStyle } from './StyleModelApplyStyle';
import { CrossAttn_EraseReplace_HiDream } from './CrossAttn_EraseReplace_HiDream';
import { ConditioningDownsampleT5 } from './ConditioningDownsampleT5';
import { ConditioningToBase64 } from './ConditioningToBase64';
import { Base64ToConditioning } from './Base64ToConditioning';
import { ConditioningBatch4 } from './ConditioningBatch4';
import { ConditioningBatch8 } from './ConditioningBatch8';
import { TemporalMaskGenerator } from './TemporalMaskGenerator';
import { TemporalSplitAttnMask } from './TemporalSplitAttnMask';
import { TemporalSplitAttnMask_Midframe } from './TemporalSplitAttnMask_Midframe';
import { TemporalCrossAttnMask } from './TemporalCrossAttnMask';
import { set_precision } from './set_precision';
import { set_precision_universal } from './set_precision_universal';
import { set_precision_advanced } from './set_precision_advanced';
import { LatentUpscaleWithVAE } from './LatentUpscaleWithVAE';
import { LatentNoised } from './LatentNoised';
import { LatentNoiseList } from './LatentNoiseList';
import { AdvancedNoise } from './AdvancedNoise';
import { LatentNoiseBatch_perlin } from './LatentNoiseBatch_perlin';
import { LatentNoiseBatch_fractal } from './LatentNoiseBatch_fractal';
import { LatentNoiseBatch_gaussian } from './LatentNoiseBatch_gaussian';
import { LatentNoiseBatch_gaussian_channels } from './LatentNoiseBatch_gaussian_channels';
import { LatentBatch_channels } from './LatentBatch_channels';
import { LatentBatch_channels_16 } from './LatentBatch_channels_16';
import { latent_get_channel_means } from './latent_get_channel_means';
import { latent_channelwise_match } from './latent_channelwise_match';
import { latent_to_raw_x } from './latent_to_raw_x';
import { latent_clear_state_info } from './latent_clear_state_info';
import { latent_replace_state_info } from './latent_replace_state_info';
import { latent_display_state_info } from './latent_display_state_info';
import { latent_extract_state_info } from './latent_extract_state_info';
import { latent_transfer_state_info } from './latent_transfer_state_info';
import { TrimVideoLatent_state_info } from './TrimVideoLatent_state_info';
import { LTXVCropGuides_state_info } from './LTXVCropGuides_state_info';
import { LatentUpscaleBy_state_info } from './LatentUpscaleBy_state_info';
import { latent_to_cuda } from './latent_to_cuda';
import { latent_batch } from './latent_batch';
import { latent_normalize_channels } from './latent_normalize_channels';
import { latent_mean_channels_from_to } from './latent_mean_channels_from_to';
import { LatentPhaseMagnitude } from './LatentPhaseMagnitude';
import { LatentPhaseMagnitudeMultiply } from './LatentPhaseMagnitudeMultiply';
import { LatentPhaseMagnitudeOffset } from './LatentPhaseMagnitudeOffset';
import { LatentPhaseMagnitudePower } from './LatentPhaseMagnitudePower';
import { MaskFloatToBoolean } from './MaskFloatToBoolean';
import { MaskToggle } from './MaskToggle';
import { MaskEdge } from './MaskEdge';
import { Frames_Masks_Uninterpolate } from './Frames_Masks_Uninterpolate';
import { Frames_Masks_ZeroOut } from './Frames_Masks_ZeroOut';
import { Frames_Latent_ReverseOrder } from './Frames_Latent_ReverseOrder';
import { EmptyLatentImage64 } from './EmptyLatentImage64';
import { EmptyLatentImageCustom } from './EmptyLatentImageCustom';
import { StableCascade_StageC_VAEEncode_Exact } from './StableCascade_StageC_VAEEncode_Exact';
import { VAEEncodeAdvanced } from './PrepForUnsampling';
import { VAEStyleTransferLatent } from './VAEStyleTransferLatent';
import { SigmasPreview } from './SigmasPreview';
import { SigmasSchedulePreview } from './SigmasSchedulePreview';
import { TorchCompileModelFluxAdvanced } from './TorchCompileModelFluxAdvanced';
import { TorchCompileModelAura } from './TorchCompileModelAura';
import { TorchCompileModelSD35 } from './TorchCompileModelSD35';
import { TorchCompileModels } from './TorchCompileModels';
import { ClownpileModelWanVideo } from './ClownpileModelWanVideo';
import { ModelSamplingAdvanced } from './ModelTimestepPatcher';
import { ModelSamplingAdvancedResolution } from './ModelSamplingAdvancedResolution';
import { FluxGuidanceDisable } from './FluxGuidanceDisable';
import { ReWanPatcher } from './ReWanPatcher';
import { ReFluxPatcher } from './ReFluxPatcher';
import { ReChromaPatcher } from './ReChromaPatcher';
import { ReSD35Patcher } from './ReSD35Patcher';
import { ReAuraPatcher } from './ReAuraPatcher';
import { ReLTXVPatcher } from './ReLTXVPatcher';
import { ReHiDreamPatcher } from './ReHiDreamPatcher';
import { ReSDPatcher } from './ReSDPatcher';
import { ReReduxPatcher } from './ReReduxPatcher';
import { ReWanPatcherAdvanced } from './ReWanPatcherAdvanced';
import { ReFluxPatcherAdvanced } from './ReFluxPatcherAdvanced';
import { ReChromaPatcherAdvanced } from './ReChromaPatcherAdvanced';
import { ReSD35PatcherAdvanced } from './ReSD35PatcherAdvanced';
import { ReAuraPatcherAdvanced } from './ReAuraPatcherAdvanced';
import { ReLTXVPatcherAdvanced } from './ReLTXVPatcherAdvanced';
import { ReHiDreamPatcherAdvanced } from './ReHiDreamPatcherAdvanced';
import { FluxOrthoCFGPatcher } from './FluxOrthoCFGPatcher';
import { UNetSave } from './UNetSave';
import { set_precision_sigmas } from './SigmasRecast';
import { sigmas_noise_inversion } from './SigmasNoiseInversion';
import { sigmas_from_text } from './SigmasFromText';
import { sigmas_variance_floor } from './SigmasVarianceFloor';
import { sigmas_truncate } from './SigmasTruncate';
import { sigmas_start } from './SigmasStart';
import { sigmas_split } from './SigmasSplit';
import { sigmas_split_value } from './SigmasSplitValue';
import { sigmas_concatenate } from './SigmasConcat';
import { sigmas_pad } from './SigmasPad';
import { sigmas_unpad } from './SigmasUnpad';
import { sigmas_set_floor } from './SigmasSetFloor';
import { sigmas_delete_below_floor } from './SigmasDeleteBelowFloor';
import { sigmas_delete_consecutive_duplicates } from './SigmasDeleteDuplicates';
import { sigmas_cleanup } from './SigmasCleanup';
import { sigmas_mult } from './SigmasMult';
import { sigmas_modulus } from './SigmasModulus';
import { sigmas_quotient } from './SigmasQuotient';
import { sigmas_add } from './SigmasAdd';
import { sigmas_power } from './SigmasPower';
import { sigmas_abs } from './SigmasAbs';
import { sigmas2_mult } from './Sigmas2Mult';
import { sigmas2_add } from './Sigmas2Add';
import { sigmas_rescale } from './SigmasRescale';
import { sigmas_count } from './SigmasCount';
import { sigmas_interpolate } from './SigmasResample';
import { sigmas_math1 } from './SigmasMath1';
import { sigmas_math3 } from './SigmasMath3';
import { sigmas_iteration_karras } from './SigmasIterationKarras';
import { sigmas_iteration_polyexp } from './SigmasIterationPolyexp';
import { sigmas_lerp } from './SigmasLerp';
import { sigmas_invlerp } from './SigmasInvLerp';
import { sigmas_arcsine } from './SigmasArcSine';
import { sigmas_linearsine } from './SigmasLinearSine';
import { sigmas_append } from './SigmasAppend';
import { sigmas_arccosine } from './SigmasArcCosine';
import { sigmas_arctangent } from './SigmasArcTangent';
import { sigmas_crossproduct } from './SigmasCrossProduct';
import { sigmas_dotproduct } from './SigmasDotProduct';
import { sigmas_fmod } from './SigmasFmod';
import { sigmas_frac } from './SigmasFrac';
import { sigmas_if } from './SigmasIf';
import { sigmas_logarithm2 } from './SigmasLogarithm2';
import { sigmas_smoothstep } from './SigmasSmoothStep';
import { sigmas_squareroot } from './SigmasSquareRoot';
import { sigmas_timestep } from './SigmasTimeStep';
import { sigmas_sigmoid } from './SigmasSigmoid';
import { sigmas_easing } from './SigmasEasing';
import { sigmas_hyperbolic } from './SigmasHyperbolic';
import { sigmas_gaussian } from './SigmasGaussian';
import { sigmas_percentile } from './SigmasPercentile';
import { sigmas_kernel_smooth } from './SigmasKernelSmooth';
import { sigmas_quantile_norm } from './SigmasQuantileNorm';
import { sigmas_adaptive_step } from './SigmasAdaptiveStep';
import { sigmas_chaos } from './SigmasChaos';
import { sigmas_reaction_diffusion } from './SigmasReactionDiffusion';
import { sigmas_attractor } from './SigmasAttractor';
import { sigmas_catmull_rom } from './SigmasCatmullRom';
import { sigmas_lambert_w } from './SigmasLambertW';
import { sigmas_zeta_eta } from './SigmasZetaEta';
import { sigmas_gamma_beta } from './SigmasGammaBeta';
import { sigmas_gaussian_cdf } from './SigmasGaussianCDF';
import { sigmas_stepwise_multirate } from './SigmasStepwiseMultirate';
import { sigmas_harmonic_decay } from './SigmasHarmonicDecay';
import { sigmas_adaptive_noise_floor } from './SigmasAdaptiveNoiseFloor';
import { sigmas_collatz_iteration } from './SigmasCollatzIteration';
import { sigmas_conway_sequence } from './SigmasConwaySequence';
import { sigmas_gilbreath_sequence } from './SigmasGilbreathSequence';
import { sigmas_cnf_inverse } from './SigmasCNFInverse';
import { sigmas_riemannian_flow } from './SigmasRiemannianFlow';
import { sigmas_langevin_dynamics } from './SigmasLangevinDynamics';
import { sigmas_persistent_homology } from './SigmasPersistentHomology';
import { sigmas_normalizing_flows } from './SigmasNormalizingFlows';
import { ClownScheduler } from './ClownScheduler';
import { tan_scheduler } from './TanScheduler';
import { tan_scheduler_2stage } from './TanScheduler2';
import { tan_scheduler_2stage_simple } from './TanScheduler2Simple';
import { constant_scheduler } from './ConstantScheduler';
import { linear_quadratic_advanced } from './LinearQuadraticAdvanced';
import { SetImageSizeWithScale } from './SetImageSizeWithScale';
import { SetImageSize } from './SetImageSize';
import { MaskBoundingBoxAspectRatio } from './MaskBoundingBoxAspectRatio';
import { Image_Get_Color_Swatches } from './ImageGetColorSwatches';
import { Masks_From_Color_Swatches } from './MasksFromColorSwatches';
import { Masks_From_Colors } from './MasksFromColors';
import { Masks_Unpack4 } from './MasksUnpack4';
import { Masks_Unpack8 } from './MasksUnpack8';
import { Masks_Unpack16 } from './MasksUnpack16';
import { ImageSharpenFS } from './ImageSharpenFS';
import { Image_Channels_LAB } from './ImageChannelsLAB';
import { ImageMedianBlur } from './ImageMedianBlur';
import { ImageGaussianBlur } from './ImageGaussianBlur';
import { Image_Pair_Split } from './ImagePairSplit';
import { Image_Crop_Location_Exact } from './ImageCropLocationExact';
import { Film_Grain } from './FilmGrain';
import { Frequency_Separation_Linear_Light } from './FrequencySeparationLinearLight';
import { Frequency_Separation_Hard_Light } from './FrequencySeparationHardLight';
import { Frequency_Separation_Hard_Light_LAB } from './FrequencySeparationHardLightLAB';
import { Frame_Select } from './FrameSelect';
import { Frames_Slice } from './FramesSlice';
import { Frames_Concat } from './FramesConcat';
import { MaskSketch } from './MaskSketch';
import { Image_Grain_Add } from './ImageGrainAdd';
import { ImageRepeatTileToSize } from './ImageRepeatTileToSize';
import { Frames_Concat_Masks } from './FramesConcatMasks';
import { Frame_Select_Latent } from './FrameSelectLatent';
import { Frames_Slice_Latent } from './FramesSliceLatent';
import { Frames_Concat_Latent } from './FramesConcatLatent';
import { Frame_Select_Latent_Raw } from './FrameSelectLatentRaw';
import { Frames_Slice_Latent_Raw } from './FramesSliceLatentRaw';
import { Frames_Concat_Latent_Raw } from './FramesConcatLatentRaw';

export { ClownsharKSampler_Beta };
export { FluxLoader };
export { SD35Loader };
export { RES4LYFModelLoader };
export { LayerPatcher };
export { TextBox1 };
export { TextBox2 };
export { TextBox3 };
export { TextConcatenate };
export { TextBoxConcatenate };
export { TextLoadFile };
export { TextShuffle };
export { TextShuffleAndTruncate };
export { TextTruncateTokens };
export { SeedGenerator };
export { ClownRegionalConditioning };
export { ClownRegionalConditionings };
export { ClownRegionalConditioning2 };
export { ClownRegionalConditioning3 };
export { ClownRegionalConditioning_AB };
export { ClownRegionalConditioning_ABC };
export { CLIPTextEncodeFluxUnguided };
export { ConditioningOrthoCollin };
export { ConditioningAverageScheduler };
export { ConditioningMultiply };
export { ConditioningAdd };
export { Conditioning_Recast64 };
export { StableCascade_StageB_Conditioning64 };
export { ConditioningZeroAndTruncate };
export { ConditioningTruncate };
export { StyleModelApplyStyle };
export { CrossAttn_EraseReplace_HiDream };
export { ConditioningDownsampleT5 };
export { ConditioningToBase64 };
export { Base64ToConditioning };
export { ConditioningBatch4 };
export { ConditioningBatch8 };
export { TemporalMaskGenerator };
export { TemporalSplitAttnMask };
export { TemporalSplitAttnMask_Midframe };
export { TemporalCrossAttnMask };
export { set_precision };
export { set_precision_universal };
export { set_precision_advanced };
export { LatentUpscaleWithVAE };
export { LatentNoised };
export { LatentNoiseList };
export { AdvancedNoise };
export { LatentNoiseBatch_perlin };
export { LatentNoiseBatch_fractal };
export { LatentNoiseBatch_gaussian };
export { LatentNoiseBatch_gaussian_channels };
export { LatentBatch_channels };
export { LatentBatch_channels_16 };
export { latent_get_channel_means };
export { latent_channelwise_match };
export { latent_to_raw_x };
export { latent_clear_state_info };
export { latent_replace_state_info };
export { latent_display_state_info };
export { latent_extract_state_info };
export { latent_transfer_state_info };
export { TrimVideoLatent_state_info };
export { LTXVCropGuides_state_info };
export { LatentUpscaleBy_state_info };
export { latent_to_cuda };
export { latent_batch };
export { latent_normalize_channels };
export { latent_mean_channels_from_to };
export { LatentPhaseMagnitude };
export { LatentPhaseMagnitudeMultiply };
export { LatentPhaseMagnitudeOffset };
export { LatentPhaseMagnitudePower };
export { MaskFloatToBoolean };
export { MaskToggle };
export { MaskEdge };
export { Frames_Masks_Uninterpolate };
export { Frames_Masks_ZeroOut };
export { Frames_Latent_ReverseOrder };
export { EmptyLatentImage64 };
export { EmptyLatentImageCustom };
export { StableCascade_StageC_VAEEncode_Exact };
export { VAEEncodeAdvanced };
export { VAEStyleTransferLatent };
export { SigmasPreview };
export { SigmasSchedulePreview };
export { TorchCompileModelFluxAdvanced };
export { TorchCompileModelAura };
export { TorchCompileModelSD35 };
export { TorchCompileModels };
export { ClownpileModelWanVideo };
export { ModelSamplingAdvanced };
export { ModelSamplingAdvancedResolution };
export { FluxGuidanceDisable };
export { ReWanPatcher };
export { ReFluxPatcher };
export { ReChromaPatcher };
export { ReSD35Patcher };
export { ReAuraPatcher };
export { ReLTXVPatcher };
export { ReHiDreamPatcher };
export { ReSDPatcher };
export { ReReduxPatcher };
export { ReWanPatcherAdvanced };
export { ReFluxPatcherAdvanced };
export { ReChromaPatcherAdvanced };
export { ReSD35PatcherAdvanced };
export { ReAuraPatcherAdvanced };
export { ReLTXVPatcherAdvanced };
export { ReHiDreamPatcherAdvanced };
export { FluxOrthoCFGPatcher };
export { UNetSave };
export { set_precision_sigmas };
export { sigmas_noise_inversion };
export { sigmas_from_text };
export { sigmas_variance_floor };
export { sigmas_truncate };
export { sigmas_start };
export { sigmas_split };
export { sigmas_split_value };
export { sigmas_concatenate };
export { sigmas_pad };
export { sigmas_unpad };
export { sigmas_set_floor };
export { sigmas_delete_below_floor };
export { sigmas_delete_consecutive_duplicates };
export { sigmas_cleanup };
export { sigmas_mult };
export { sigmas_modulus };
export { sigmas_quotient };
export { sigmas_add };
export { sigmas_power };
export { sigmas_abs };
export { sigmas2_mult };
export { sigmas2_add };
export { sigmas_rescale };
export { sigmas_count };
export { sigmas_interpolate };
export { sigmas_math1 };
export { sigmas_math3 };
export { sigmas_iteration_karras };
export { sigmas_iteration_polyexp };
export { sigmas_lerp };
export { sigmas_invlerp };
export { sigmas_arcsine };
export { sigmas_linearsine };
export { sigmas_append };
export { sigmas_arccosine };
export { sigmas_arctangent };
export { sigmas_crossproduct };
export { sigmas_dotproduct };
export { sigmas_fmod };
export { sigmas_frac };
export { sigmas_if };
export { sigmas_logarithm2 };
export { sigmas_smoothstep };
export { sigmas_squareroot };
export { sigmas_timestep };
export { sigmas_sigmoid };
export { sigmas_easing };
export { sigmas_hyperbolic };
export { sigmas_gaussian };
export { sigmas_percentile };
export { sigmas_kernel_smooth };
export { sigmas_quantile_norm };
export { sigmas_adaptive_step };
export { sigmas_chaos };
export { sigmas_reaction_diffusion };
export { sigmas_attractor };
export { sigmas_catmull_rom };
export { sigmas_lambert_w };
export { sigmas_zeta_eta };
export { sigmas_gamma_beta };
export { sigmas_gaussian_cdf };
export { sigmas_stepwise_multirate };
export { sigmas_harmonic_decay };
export { sigmas_adaptive_noise_floor };
export { sigmas_collatz_iteration };
export { sigmas_conway_sequence };
export { sigmas_gilbreath_sequence };
export { sigmas_cnf_inverse };
export { sigmas_riemannian_flow };
export { sigmas_langevin_dynamics };
export { sigmas_persistent_homology };
export { sigmas_normalizing_flows };
export { ClownScheduler };
export { tan_scheduler };
export { tan_scheduler_2stage };
export { tan_scheduler_2stage_simple };
export { constant_scheduler };
export { linear_quadratic_advanced };
export { SetImageSizeWithScale };
export { SetImageSize };
export { MaskBoundingBoxAspectRatio };
export { Image_Get_Color_Swatches };
export { Masks_From_Color_Swatches };
export { Masks_From_Colors };
export { Masks_Unpack4 };
export { Masks_Unpack8 };
export { Masks_Unpack16 };
export { ImageSharpenFS };
export { Image_Channels_LAB };
export { ImageMedianBlur };
export { ImageGaussianBlur };
export { Image_Pair_Split };
export { Image_Crop_Location_Exact };
export { Film_Grain };
export { Frequency_Separation_Linear_Light };
export { Frequency_Separation_Hard_Light };
export { Frequency_Separation_Hard_Light_LAB };
export { Frame_Select };
export { Frames_Slice };
export { Frames_Concat };
export { MaskSketch };
export { Image_Grain_Add };
export { ImageRepeatTileToSize };
export { Frames_Concat_Masks };
export { Frame_Select_Latent };
export { Frames_Slice_Latent };
export { Frames_Concat_Latent };
export { Frame_Select_Latent_Raw };
export { Frames_Slice_Latent_Raw };
export { Frames_Concat_Latent_Raw };

// ── Registry record ──────────────────────────────────────────────────────────
export const res4lyfNodes: Record<string, NodeWidgetLayout> = {
    [ClownsharKSampler_Beta.nodeType]: ClownsharKSampler_Beta,
    [FluxLoader.nodeType]: FluxLoader,
    [SD35Loader.nodeType]: SD35Loader,
    [RES4LYFModelLoader.nodeType]: RES4LYFModelLoader,
    [LayerPatcher.nodeType]: LayerPatcher,
    [TextBox1.nodeType]: TextBox1,
    [TextBox2.nodeType]: TextBox2,
    [TextBox3.nodeType]: TextBox3,
    [TextConcatenate.nodeType]: TextConcatenate,
    [TextBoxConcatenate.nodeType]: TextBoxConcatenate,
    [TextLoadFile.nodeType]: TextLoadFile,
    [TextShuffle.nodeType]: TextShuffle,
    [TextShuffleAndTruncate.nodeType]: TextShuffleAndTruncate,
    [TextTruncateTokens.nodeType]: TextTruncateTokens,
    [SeedGenerator.nodeType]: SeedGenerator,
    [ClownRegionalConditioning.nodeType]: ClownRegionalConditioning,
    [ClownRegionalConditionings.nodeType]: ClownRegionalConditionings,
    [ClownRegionalConditioning2.nodeType]: ClownRegionalConditioning2,
    [ClownRegionalConditioning3.nodeType]: ClownRegionalConditioning3,
    [ClownRegionalConditioning_AB.nodeType]: ClownRegionalConditioning_AB,
    [ClownRegionalConditioning_ABC.nodeType]: ClownRegionalConditioning_ABC,
    [CLIPTextEncodeFluxUnguided.nodeType]: CLIPTextEncodeFluxUnguided,
    [ConditioningOrthoCollin.nodeType]: ConditioningOrthoCollin,
    [ConditioningAverageScheduler.nodeType]: ConditioningAverageScheduler,
    [ConditioningMultiply.nodeType]: ConditioningMultiply,
    [ConditioningAdd.nodeType]: ConditioningAdd,
    [Conditioning_Recast64.nodeType]: Conditioning_Recast64,
    [StableCascade_StageB_Conditioning64.nodeType]: StableCascade_StageB_Conditioning64,
    [ConditioningZeroAndTruncate.nodeType]: ConditioningZeroAndTruncate,
    [ConditioningTruncate.nodeType]: ConditioningTruncate,
    [StyleModelApplyStyle.nodeType]: StyleModelApplyStyle,
    [CrossAttn_EraseReplace_HiDream.nodeType]: CrossAttn_EraseReplace_HiDream,
    [ConditioningDownsampleT5.nodeType]: ConditioningDownsampleT5,
    [ConditioningToBase64.nodeType]: ConditioningToBase64,
    [Base64ToConditioning.nodeType]: Base64ToConditioning,
    [ConditioningBatch4.nodeType]: ConditioningBatch4,
    [ConditioningBatch8.nodeType]: ConditioningBatch8,
    [TemporalMaskGenerator.nodeType]: TemporalMaskGenerator,
    [TemporalSplitAttnMask.nodeType]: TemporalSplitAttnMask,
    [TemporalSplitAttnMask_Midframe.nodeType]: TemporalSplitAttnMask_Midframe,
    [TemporalCrossAttnMask.nodeType]: TemporalCrossAttnMask,
    [set_precision.nodeType]: set_precision,
    [set_precision_universal.nodeType]: set_precision_universal,
    [set_precision_advanced.nodeType]: set_precision_advanced,
    [LatentUpscaleWithVAE.nodeType]: LatentUpscaleWithVAE,
    [LatentNoised.nodeType]: LatentNoised,
    [LatentNoiseList.nodeType]: LatentNoiseList,
    [AdvancedNoise.nodeType]: AdvancedNoise,
    [LatentNoiseBatch_perlin.nodeType]: LatentNoiseBatch_perlin,
    [LatentNoiseBatch_fractal.nodeType]: LatentNoiseBatch_fractal,
    [LatentNoiseBatch_gaussian.nodeType]: LatentNoiseBatch_gaussian,
    [LatentNoiseBatch_gaussian_channels.nodeType]: LatentNoiseBatch_gaussian_channels,
    [LatentBatch_channels.nodeType]: LatentBatch_channels,
    [LatentBatch_channels_16.nodeType]: LatentBatch_channels_16,
    [latent_get_channel_means.nodeType]: latent_get_channel_means,
    [latent_channelwise_match.nodeType]: latent_channelwise_match,
    [latent_to_raw_x.nodeType]: latent_to_raw_x,
    [latent_clear_state_info.nodeType]: latent_clear_state_info,
    [latent_replace_state_info.nodeType]: latent_replace_state_info,
    [latent_display_state_info.nodeType]: latent_display_state_info,
    [latent_extract_state_info.nodeType]: latent_extract_state_info,
    [latent_transfer_state_info.nodeType]: latent_transfer_state_info,
    [TrimVideoLatent_state_info.nodeType]: TrimVideoLatent_state_info,
    [LTXVCropGuides_state_info.nodeType]: LTXVCropGuides_state_info,
    [LatentUpscaleBy_state_info.nodeType]: LatentUpscaleBy_state_info,
    [latent_to_cuda.nodeType]: latent_to_cuda,
    [latent_batch.nodeType]: latent_batch,
    [latent_normalize_channels.nodeType]: latent_normalize_channels,
    [latent_mean_channels_from_to.nodeType]: latent_mean_channels_from_to,
    [LatentPhaseMagnitude.nodeType]: LatentPhaseMagnitude,
    [LatentPhaseMagnitudeMultiply.nodeType]: LatentPhaseMagnitudeMultiply,
    [LatentPhaseMagnitudeOffset.nodeType]: LatentPhaseMagnitudeOffset,
    [LatentPhaseMagnitudePower.nodeType]: LatentPhaseMagnitudePower,
    [MaskFloatToBoolean.nodeType]: MaskFloatToBoolean,
    [MaskToggle.nodeType]: MaskToggle,
    [MaskEdge.nodeType]: MaskEdge,
    [Frames_Masks_Uninterpolate.nodeType]: Frames_Masks_Uninterpolate,
    [Frames_Masks_ZeroOut.nodeType]: Frames_Masks_ZeroOut,
    [Frames_Latent_ReverseOrder.nodeType]: Frames_Latent_ReverseOrder,
    [EmptyLatentImage64.nodeType]: EmptyLatentImage64,
    [EmptyLatentImageCustom.nodeType]: EmptyLatentImageCustom,
    [StableCascade_StageC_VAEEncode_Exact.nodeType]: StableCascade_StageC_VAEEncode_Exact,
    [VAEEncodeAdvanced.nodeType]: VAEEncodeAdvanced,
    [VAEStyleTransferLatent.nodeType]: VAEStyleTransferLatent,
    [SigmasPreview.nodeType]: SigmasPreview,
    [SigmasSchedulePreview.nodeType]: SigmasSchedulePreview,
    [TorchCompileModelFluxAdvanced.nodeType]: TorchCompileModelFluxAdvanced,
    [TorchCompileModelAura.nodeType]: TorchCompileModelAura,
    [TorchCompileModelSD35.nodeType]: TorchCompileModelSD35,
    [TorchCompileModels.nodeType]: TorchCompileModels,
    [ClownpileModelWanVideo.nodeType]: ClownpileModelWanVideo,
    [ModelSamplingAdvanced.nodeType]: ModelSamplingAdvanced,
    [ModelSamplingAdvancedResolution.nodeType]: ModelSamplingAdvancedResolution,
    [FluxGuidanceDisable.nodeType]: FluxGuidanceDisable,
    [ReWanPatcher.nodeType]: ReWanPatcher,
    [ReFluxPatcher.nodeType]: ReFluxPatcher,
    [ReChromaPatcher.nodeType]: ReChromaPatcher,
    [ReSD35Patcher.nodeType]: ReSD35Patcher,
    [ReAuraPatcher.nodeType]: ReAuraPatcher,
    [ReLTXVPatcher.nodeType]: ReLTXVPatcher,
    [ReHiDreamPatcher.nodeType]: ReHiDreamPatcher,
    [ReSDPatcher.nodeType]: ReSDPatcher,
    [ReReduxPatcher.nodeType]: ReReduxPatcher,
    [ReWanPatcherAdvanced.nodeType]: ReWanPatcherAdvanced,
    [ReFluxPatcherAdvanced.nodeType]: ReFluxPatcherAdvanced,
    [ReChromaPatcherAdvanced.nodeType]: ReChromaPatcherAdvanced,
    [ReSD35PatcherAdvanced.nodeType]: ReSD35PatcherAdvanced,
    [ReAuraPatcherAdvanced.nodeType]: ReAuraPatcherAdvanced,
    [ReLTXVPatcherAdvanced.nodeType]: ReLTXVPatcherAdvanced,
    [ReHiDreamPatcherAdvanced.nodeType]: ReHiDreamPatcherAdvanced,
    [FluxOrthoCFGPatcher.nodeType]: FluxOrthoCFGPatcher,
    [UNetSave.nodeType]: UNetSave,
    [set_precision_sigmas.nodeType]: set_precision_sigmas,
    [sigmas_noise_inversion.nodeType]: sigmas_noise_inversion,
    [sigmas_from_text.nodeType]: sigmas_from_text,
    [sigmas_variance_floor.nodeType]: sigmas_variance_floor,
    [sigmas_truncate.nodeType]: sigmas_truncate,
    [sigmas_start.nodeType]: sigmas_start,
    [sigmas_split.nodeType]: sigmas_split,
    [sigmas_split_value.nodeType]: sigmas_split_value,
    [sigmas_concatenate.nodeType]: sigmas_concatenate,
    [sigmas_pad.nodeType]: sigmas_pad,
    [sigmas_unpad.nodeType]: sigmas_unpad,
    [sigmas_set_floor.nodeType]: sigmas_set_floor,
    [sigmas_delete_below_floor.nodeType]: sigmas_delete_below_floor,
    [sigmas_delete_consecutive_duplicates.nodeType]: sigmas_delete_consecutive_duplicates,
    [sigmas_cleanup.nodeType]: sigmas_cleanup,
    [sigmas_mult.nodeType]: sigmas_mult,
    [sigmas_modulus.nodeType]: sigmas_modulus,
    [sigmas_quotient.nodeType]: sigmas_quotient,
    [sigmas_add.nodeType]: sigmas_add,
    [sigmas_power.nodeType]: sigmas_power,
    [sigmas_abs.nodeType]: sigmas_abs,
    [sigmas2_mult.nodeType]: sigmas2_mult,
    [sigmas2_add.nodeType]: sigmas2_add,
    [sigmas_rescale.nodeType]: sigmas_rescale,
    [sigmas_count.nodeType]: sigmas_count,
    [sigmas_interpolate.nodeType]: sigmas_interpolate,
    [sigmas_math1.nodeType]: sigmas_math1,
    [sigmas_math3.nodeType]: sigmas_math3,
    [sigmas_iteration_karras.nodeType]: sigmas_iteration_karras,
    [sigmas_iteration_polyexp.nodeType]: sigmas_iteration_polyexp,
    [sigmas_lerp.nodeType]: sigmas_lerp,
    [sigmas_invlerp.nodeType]: sigmas_invlerp,
    [sigmas_arcsine.nodeType]: sigmas_arcsine,
    [sigmas_linearsine.nodeType]: sigmas_linearsine,
    [sigmas_append.nodeType]: sigmas_append,
    [sigmas_arccosine.nodeType]: sigmas_arccosine,
    [sigmas_arctangent.nodeType]: sigmas_arctangent,
    [sigmas_crossproduct.nodeType]: sigmas_crossproduct,
    [sigmas_dotproduct.nodeType]: sigmas_dotproduct,
    [sigmas_fmod.nodeType]: sigmas_fmod,
    [sigmas_frac.nodeType]: sigmas_frac,
    [sigmas_if.nodeType]: sigmas_if,
    [sigmas_logarithm2.nodeType]: sigmas_logarithm2,
    [sigmas_smoothstep.nodeType]: sigmas_smoothstep,
    [sigmas_squareroot.nodeType]: sigmas_squareroot,
    [sigmas_timestep.nodeType]: sigmas_timestep,
    [sigmas_sigmoid.nodeType]: sigmas_sigmoid,
    [sigmas_easing.nodeType]: sigmas_easing,
    [sigmas_hyperbolic.nodeType]: sigmas_hyperbolic,
    [sigmas_gaussian.nodeType]: sigmas_gaussian,
    [sigmas_percentile.nodeType]: sigmas_percentile,
    [sigmas_kernel_smooth.nodeType]: sigmas_kernel_smooth,
    [sigmas_quantile_norm.nodeType]: sigmas_quantile_norm,
    [sigmas_adaptive_step.nodeType]: sigmas_adaptive_step,
    [sigmas_chaos.nodeType]: sigmas_chaos,
    [sigmas_reaction_diffusion.nodeType]: sigmas_reaction_diffusion,
    [sigmas_attractor.nodeType]: sigmas_attractor,
    [sigmas_catmull_rom.nodeType]: sigmas_catmull_rom,
    [sigmas_lambert_w.nodeType]: sigmas_lambert_w,
    [sigmas_zeta_eta.nodeType]: sigmas_zeta_eta,
    [sigmas_gamma_beta.nodeType]: sigmas_gamma_beta,
    [sigmas_gaussian_cdf.nodeType]: sigmas_gaussian_cdf,
    [sigmas_stepwise_multirate.nodeType]: sigmas_stepwise_multirate,
    [sigmas_harmonic_decay.nodeType]: sigmas_harmonic_decay,
    [sigmas_adaptive_noise_floor.nodeType]: sigmas_adaptive_noise_floor,
    [sigmas_collatz_iteration.nodeType]: sigmas_collatz_iteration,
    [sigmas_conway_sequence.nodeType]: sigmas_conway_sequence,
    [sigmas_gilbreath_sequence.nodeType]: sigmas_gilbreath_sequence,
    [sigmas_cnf_inverse.nodeType]: sigmas_cnf_inverse,
    [sigmas_riemannian_flow.nodeType]: sigmas_riemannian_flow,
    [sigmas_langevin_dynamics.nodeType]: sigmas_langevin_dynamics,
    [sigmas_persistent_homology.nodeType]: sigmas_persistent_homology,
    [sigmas_normalizing_flows.nodeType]: sigmas_normalizing_flows,
    [ClownScheduler.nodeType]: ClownScheduler,
    [tan_scheduler.nodeType]: tan_scheduler,
    [tan_scheduler_2stage.nodeType]: tan_scheduler_2stage,
    [tan_scheduler_2stage_simple.nodeType]: tan_scheduler_2stage_simple,
    [constant_scheduler.nodeType]: constant_scheduler,
    [linear_quadratic_advanced.nodeType]: linear_quadratic_advanced,
    [SetImageSizeWithScale.nodeType]: SetImageSizeWithScale,
    [SetImageSize.nodeType]: SetImageSize,
    [MaskBoundingBoxAspectRatio.nodeType]: MaskBoundingBoxAspectRatio,
    [Image_Get_Color_Swatches.nodeType]: Image_Get_Color_Swatches,
    [Masks_From_Color_Swatches.nodeType]: Masks_From_Color_Swatches,
    [Masks_From_Colors.nodeType]: Masks_From_Colors,
    [Masks_Unpack4.nodeType]: Masks_Unpack4,
    [Masks_Unpack8.nodeType]: Masks_Unpack8,
    [Masks_Unpack16.nodeType]: Masks_Unpack16,
    [ImageSharpenFS.nodeType]: ImageSharpenFS,
    [Image_Channels_LAB.nodeType]: Image_Channels_LAB,
    [ImageMedianBlur.nodeType]: ImageMedianBlur,
    [ImageGaussianBlur.nodeType]: ImageGaussianBlur,
    [Image_Pair_Split.nodeType]: Image_Pair_Split,
    [Image_Crop_Location_Exact.nodeType]: Image_Crop_Location_Exact,
    [Film_Grain.nodeType]: Film_Grain,
    [Frequency_Separation_Linear_Light.nodeType]: Frequency_Separation_Linear_Light,
    [Frequency_Separation_Hard_Light.nodeType]: Frequency_Separation_Hard_Light,
    [Frequency_Separation_Hard_Light_LAB.nodeType]: Frequency_Separation_Hard_Light_LAB,
    [Frame_Select.nodeType]: Frame_Select,
    [Frames_Slice.nodeType]: Frames_Slice,
    [Frames_Concat.nodeType]: Frames_Concat,
    [MaskSketch.nodeType]: MaskSketch,
    [Image_Grain_Add.nodeType]: Image_Grain_Add,
    [ImageRepeatTileToSize.nodeType]: ImageRepeatTileToSize,
    [Frames_Concat_Masks.nodeType]: Frames_Concat_Masks,
    [Frame_Select_Latent.nodeType]: Frame_Select_Latent,
    [Frames_Slice_Latent.nodeType]: Frames_Slice_Latent,
    [Frames_Concat_Latent.nodeType]: Frames_Concat_Latent,
    [Frame_Select_Latent_Raw.nodeType]: Frame_Select_Latent_Raw,
    [Frames_Slice_Latent_Raw.nodeType]: Frames_Slice_Latent_Raw,
    [Frames_Concat_Latent_Raw.nodeType]: Frames_Concat_Latent_Raw,
};
