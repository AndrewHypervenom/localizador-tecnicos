import 'react-native-url-polyfill/auto';
import './src/services/locationTask'; // register background task BEFORE any rendering
import './src/services/watchdog';     // register watchdog task at module level
import './src/services/bootTask';     // register headless task that resumes tracking on boot
import { registerRootComponent } from 'expo';
import App from './src/App';

registerRootComponent(App);
