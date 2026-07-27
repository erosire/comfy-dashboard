import { asServiceHandler } from '@underload/service';
import { cloudPrompt } from './cloud-prompt';

export default {
    route: '/v1/comfy/cloud/prompt',
    handler: asServiceHandler({
        POST: cloudPrompt,
    })
};
