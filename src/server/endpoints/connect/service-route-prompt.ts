// Route registration for reading one prompt-specific websocket event log.

import { asServiceHandler } from '@underload/service';
import { getConnectedPromptLog } from './connect';

export default {
    route: '/v1/comfy/connect/:connect_id/:prompt_id',
    handler: asServiceHandler({
        GET: getConnectedPromptLog
    })
};
