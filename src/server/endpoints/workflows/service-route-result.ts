import { asServiceHandler } from '@underload/service';
import { workflowGenerateResultGet } from './workflow-result';

export default {
    route: '/v1/comfy/workflows/:id/generate/:generate_id/result/:index',
    handler: asServiceHandler({
        GET: workflowGenerateResultGet,
    })
};
