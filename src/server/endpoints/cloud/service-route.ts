import { asServiceHandler } from '@underload/service';
import { createCloudPod } from './cloud';

export default {
    route: '/v1/comfy/cloud',
    handler: asServiceHandler({
        POST: createCloudPod
    })
};
