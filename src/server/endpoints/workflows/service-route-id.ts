import { asServiceHandler } from '@underload/service';
import { workflowGet } from './workflow-get';
import { workflowPatch } from './workflow-patch';
import { workflowDelete } from './workflow-delete';

export default {
    route: '/v1/comfy/workflows/:id',
    handler: asServiceHandler({
        GET: workflowGet,
        PATCH: workflowPatch,
        DELETE: workflowDelete,
    })
};
