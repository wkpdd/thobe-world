# Test lab: Thobe World + H47 Pay on a separate Windows

H47 Pay's server install takes `C:\ProgramData\NewStore`, port 7331 and Windows
services, so a test copy cannot run on the shop's PC next to the real one. This
lab runs both in a separate Windows instead:

- the store on `http://127.0.0.1:8080`, with an empty catalogue
- H47 Pay in SERVER mode, for a test company you connect to that store
- the deploy tool, set up for `thobeworld.com` by FTPS

## Option A: Windows Sandbox (free, on your PC, wiped on close)

Needs Windows 10/11 **Pro, Enterprise or Education**.

1. Turn on « Windows Sandbox » in *Turn Windows features on or off*, then
   restart.
2. Create the folder `E:\h47-lab`. Put three files in it:
   - `H47Lab.wsb` and `setup-lab.ps1`, from this folder
   - `H47Pay-<version>-setup.exe`
3. Double-click `H47Lab.wsb`. Setup takes about 5 minutes the first time. If
   Windows asks for permission for the H47 Pay setup, click Yes.
4. Follow `E:\h47-lab\LAB-README.txt`. It holds the store address and the sync
   key to type in H47 Pay « Mon site web ». Inside the sandbox the same folder
   is `C:\h47-lab`, because the sandbox has only a C: drive.

What is kept when the sandbox closes:
- **Kept**, because it is in `E:\h47-lab` on your PC: the code, `.deploy.env`
  and the store's data.
- **Not kept:** H47 Pay's test data. Each start begins with a fresh install.

## Option B: a virtual machine or cloud PC (persistent)

Use this for Windows Home, or to keep the test company between sessions:

- VirtualBox or Hyper-V, with a Windows 11 evaluation image
- a rented Windows cloud server, used through Remote Desktop

On that machine:
1. Create a lab folder (for example `E:\h47-lab`) and copy `setup-lab.ps1`
   and the H47 Pay setup into it. The script uses the folder it is in.
2. In PowerShell **as administrator**, run:
   ```
   powershell -ExecutionPolicy Bypass -File E:\h47-lab\setup-lab.ps1
   ```

Run the script again at any time to update the code. Steps that are already
done are skipped.
