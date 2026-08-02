// Route registration for establishing a managed ComfyUI server connection.

import { asServiceHandler } from '@underload/service';
import { connectServer } from './connect';

export default {
    route: '/v1/comfy/connect',
    handler: asServiceHandler({
        POST: connectServer
    })
};
