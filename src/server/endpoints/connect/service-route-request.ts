// Route registration for reading one client-specific websocket event log.

import { asServiceHandler } from '@underload/service';
import { getConnectedRequest } from './connect';

export default {
    route: '/v1/comfy/cloud/connect/:connect_id/request/:client_id',
    handler: asServiceHandler({
        GET: getConnectedRequest
    })
};
