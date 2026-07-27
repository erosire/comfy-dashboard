import { asServiceHandler } from '@underload/service';
import { workflowGet } from './workflow-get';
import { workflowCreate } from './workflow-create';
import { workflowDelete } from './workflow-delete';

export default {
    route: '/api/workflows/:id',
    handler: asServiceHandler({
        GET: workflowGet,
        POST: workflowCreate,
        DELETE: workflowDelete,
    })
};
