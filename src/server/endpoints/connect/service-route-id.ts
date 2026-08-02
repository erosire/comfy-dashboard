// Route registration for prompts sent through a live connectId.

import { asServiceHandler } from '@underload/service';
import { sendConnectedPrompt } from './connect';

export default {
    route: '/v1/comfy/connect/:connect_id',
    handler: asServiceHandler({
        POST: sendConnectedPrompt
    })
};
