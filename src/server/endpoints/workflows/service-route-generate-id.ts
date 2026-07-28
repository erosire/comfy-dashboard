import { asServiceHandler } from '@underload/service';
import { workflowGenerateUpdate } from './workflow-generate';

export default {
    route: '/v1/comfy/workflows/:id/generate/:generate_id',
    handler: asServiceHandler({
        PUT: workflowGenerateUpdate,
    })
};
