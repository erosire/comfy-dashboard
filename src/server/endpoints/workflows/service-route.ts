import { asServiceHandler } from '@underload/service';
import { workflowList } from './workflow-list';

export default {
    route: '/api/workflows',
    handler: asServiceHandler({
        GET: workflowList,
    })
};
