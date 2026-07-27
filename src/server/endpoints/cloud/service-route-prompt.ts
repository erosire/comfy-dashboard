import { asServiceHandler } from '@underload/service';
import { cloudPrompt } from './cloud-prompt';

export default {
    route: '/api/cloud/prompt',
    handler: asServiceHandler({
        POST: cloudPrompt,
    })
};
