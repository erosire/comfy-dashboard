import { asServiceHandler } from '@underload/service';
import { workflowList } from './workflow-list';
import { workflowCreate } from './workflow-create';

export default {
    port: 5350,
    route: '/v1/comfy/workflows',
    handler: asServiceHandler({
        GET: workflowList,
        POST: workflowCreate
    })
};
