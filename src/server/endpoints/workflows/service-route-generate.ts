import { asServiceHandler } from '@underload/service';
import { workflowGenerate } from './workflow-generate';

export default {
    route: '/v1/comfy/workflows/:id/generate',
    handler: asServiceHandler({
        POST: workflowGenerate,
    })
};
