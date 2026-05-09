import 'react-native-url-polyfill/auto';
import './src/services/locationTask'; // register background task BEFORE any rendering
import { registerRootComponent } from 'expo';
import App from './src/App';

registerRootComponent(App);
