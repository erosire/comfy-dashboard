// Route registration for opening a persistent direct ComfyUI connection.

import { asServiceHandler } from '@underload/service';
import { connectPod } from './connect';

export default {
    route: '/v1/comfy/connect',
    handler: asServiceHandler({
        POST: connectPod
    })
};
