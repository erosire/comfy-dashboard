import { asServiceHandler } from '@underload/service';
import { cloudQueueSubmit } from './cloud-queue-submit';
import { cloudQueueList } from './cloud-queue-list';

export default {
    route: '/v1/comfy/cloud/queue',
    handler: asServiceHandler({
        GET: cloudQueueList,
        POST: cloudQueueSubmit,
    })
};
