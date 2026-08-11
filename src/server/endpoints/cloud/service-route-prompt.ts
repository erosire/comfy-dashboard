import { asServiceHandler } from '@underload/service';
import { cloudPrompt } from './cloud-prompt';

export default {
    port: 5300,
    route: '/v1/comfy/cloud/prompt',
    handler: asServiceHandler({
        POST: cloudPrompt
    })
};
