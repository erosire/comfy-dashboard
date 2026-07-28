import { asServiceHandler } from '@underload/service';
import { cloudQueueDelete } from './cloud-queue-delete';

export default {
    route: '/v1/comfy/cloud/prompt/:promptId',
    handler: asServiceHandler({
        DELETE: cloudQueueDelete,
    })
};
