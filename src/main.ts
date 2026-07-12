import { render } from 'azerothjs';

import Counter from './counter.azeroth';

render(() => Counter({ start: 0 }), document.getElementById('root')!);
