import { asServiceHandler } from '@underload/service';
import { workflowGenerateList, workflowGenerateCreate } from './workflow-generate';

export default {
    route: '/v1/comfy/workflows/:id/generate',
    handler: asServiceHandler({
        GET: workflowGenerateList,
        POST: workflowGenerateCreate,
    })
};
