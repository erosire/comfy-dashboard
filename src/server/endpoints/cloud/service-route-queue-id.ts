import { asServiceHandler } from '@underload/service';
import { cloudQueueDelete } from './cloud-queue-delete';

export default {
    route: '/v1/comfy/cloud/queue/:promptId',
    handler: asServiceHandler({
        DELETE: cloudQueueDelete,
    })
};
