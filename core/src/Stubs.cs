namespace SharpDX {
  public static class Utilities {
    public static int SizeOf<T>() where T : struct => System.Runtime.InteropServices.Marshal.SizeOf<T>();
  }
}
