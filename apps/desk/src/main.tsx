import { createRoot } from 'react-dom/client';
import { Desk } from './components/Desk';
import { Pet } from './components/Pet';
import { QuickAdd } from './components/QuickAdd';
import { Snip } from './components/Snip';
import { currentView } from './platform';
import './styles.css';

const view = currentView();
document.documentElement.dataset.view = view;

// No StrictMode: the pet window owns the sync loop and must start exactly once.
createRoot(document.getElementById('root')!).render(
  view === 'pet' ? <Pet /> : view === 'quickadd' ? <QuickAdd /> : view === 'snip' ? <Snip /> : <Desk />,
);
