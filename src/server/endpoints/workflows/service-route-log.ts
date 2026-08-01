import { asServiceHandler } from '@underload/service';
import { workflowGenerateLogGet } from './workflow-log';

export default {
    route: '/v1/comfy/workflows/:id/generate/:generate_id/log',
    handler: asServiceHandler({
        GET: workflowGenerateLogGet,
    })
};
