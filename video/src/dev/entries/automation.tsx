import { registerRoot } from 'remotion';
import { sceneRoot } from '../SceneRoot';
import Scene from '../../scenes/Automation';

registerRoot(sceneRoot('automation', Scene));
