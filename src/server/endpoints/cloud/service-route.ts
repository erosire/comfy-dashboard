import { asServiceHandler } from '@underload/service';
import { cloudCreate } from './cloud-create';

export default {
    route: '/api/cloud/create',
    handler: asServiceHandler({
        GET: cloudCreate,
    })
};
