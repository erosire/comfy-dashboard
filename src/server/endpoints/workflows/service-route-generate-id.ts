import { asServiceHandler } from '@underload/service';
import { workflowGenerateDelete, workflowGenerateGet, workflowGenerateUpdate } from './workflow-generate';

export default {
    route: '/v1/comfy/workflows/:id/generate/:generate_id',
    handler: asServiceHandler({
        GET: workflowGenerateGet,
        PUT: workflowGenerateUpdate,
        DELETE: workflowGenerateDelete,
    })
};
