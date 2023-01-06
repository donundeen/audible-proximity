#!/bin/bash

chmod a+x /home/pi/audible-proximity/pijuice_utils/pijuice_utils.py
line="*/5 * * * * /usr/bin/date >> /home/pi/juicemonitor.txt  2>&1; /home/pi/audible-proximity/pijuice_utils/pijuice_utils.py --get-input >> /home/pi/juicemonitor.txt 2>&1; /home/pi/audible-proximity/pijuice_utils/pijuice_utils.py --get-battery >> /home/pi/juicemonitor.txt  2>&1"
(crontab -u $(whoami) -l; echo "$line" ) | crontab -u $(whoami) -
