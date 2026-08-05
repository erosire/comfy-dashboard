import { asServiceHandler } from '@underload/service';
import { createCloudPod, listCloudPods } from './cloud';

export default {
    route: '/v1/comfy/cloud',
    handler: asServiceHandler({
        // GET lists the server's active pods (live persistent websockets)
        // with per-pod in-flight prompt counts — the UI polls this to keep
        // its pod buttons in sync.
        GET: listCloudPods,
        // POST creates a pod (blocking until its persistent websocket is
        // connected) or reports/adopts an existing pod's status.
        POST: createCloudPod
    })
};
