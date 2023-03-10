@echo off
::Check if the "node_modules" folder is present
if not exist node_modules (
	::Generate the directory via npm
	echo "node_modules" not found. Creating it...
	call npm install
    call npm install typescript -g
)

:: Download all the packages in case there are any new ones
call npm install

::Compile the repository to JS
call npm run-script build

::Run the built JS module
npm run-script run-js