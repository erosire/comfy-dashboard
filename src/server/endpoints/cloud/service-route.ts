import { asServiceHandler } from '@underload/service';
import { cloudCreate } from './cloud-create';

export default {
    route: '/v1/comfy/cloud/create',
    handler: asServiceHandler({
        GET: cloudCreate,
    })
};
